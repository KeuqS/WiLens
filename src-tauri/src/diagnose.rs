//! Connection check: is there a network link, does the router answer, do
//! website names resolve, and does the internet answer (or a sign-in page)?
//!
//! The check only runs when the user asks for it. Besides the user's own
//! router it contacts one plain-HTTP address: the one the operating system
//! itself uses to detect sign-in pages (`captive.apple.com` on macOS,
//! `www.msftconnecttest.com` on Windows). The result-reading and summary logic
//! are plain functions so they are tested without touching the network.

use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;

use serde::Serialize;

const DNS_TIMEOUT: Duration = Duration::from_secs(5);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const IO_TIMEOUT: Duration = Duration::from_secs(5);
/// The probe pages are tiny; anything larger is a portal page or junk.
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;

/// The page the operating system uses to tell "online" from "behind a
/// sign-in page", and the text a working connection returns.
struct ProbeTarget {
    host: &'static str,
    path: &'static str,
    expected: &'static str,
}

#[cfg(windows)]
const PROBE: ProbeTarget = ProbeTarget {
    host: "www.msftconnecttest.com",
    path: "/connecttest.txt",
    expected: "Microsoft Connect Test",
};

#[cfg(not(windows))]
const PROBE: ProbeTarget = ProbeTarget {
    host: "captive.apple.com",
    path: "/hotspot-detect.html",
    expected: "Success",
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Pass,
    Warn,
    Fail,
    Skipped,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: &'static str,
    pub status: Status,
    pub detail: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Ok,
    NoNetwork,
    RouterUnreachable,
    DnsBroken,
    SignInRequired,
    NoInternet,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub steps: Vec<Step>,
    pub verdict: Verdict,
    pub summary: String,
}

/// What the internet probe found.
#[derive(Debug, PartialEq, Eq)]
pub enum Probe {
    Online,
    /// Something answered, but not with the expected page: a sign-in
    /// (captive) portal is intercepting traffic.
    SignInRequired,
    Offline(String),
}

/// Whether the router answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Router {
    Answered,
    Silent,
    /// No default gateway, or ping could not run.
    Unknown,
}

/// Run every step in order, reporting each one through `progress` as it
/// finishes.
pub fn run(progress: &dyn Fn(&Step)) -> Report {
    let mut steps = Vec::new();
    let record = |steps: &mut Vec<Step>, step: Step| {
        progress(&step);
        steps.push(step);
    };

    let interface = netdev::get_default_interface()
        .ok()
        .filter(|interface| !interface.ipv4.is_empty());
    let Some(interface) = interface else {
        record(
            &mut steps,
            step(
                "link",
                Status::Fail,
                "No active network connection was found.",
            ),
        );
        for id in ["router", "dns", "internet"] {
            record(
                &mut steps,
                step(id, Status::Skipped, "Skipped: no network connection."),
            );
        }
        let (verdict, summary) = summarize(
            false,
            Router::Unknown,
            false,
            &Probe::Offline(String::new()),
        );
        return Report {
            steps,
            verdict,
            summary,
        };
    };

    let name = interface
        .friendly_name
        .clone()
        .unwrap_or_else(|| interface.name.clone());
    let address = interface.ipv4[0].addr();
    record(
        &mut steps,
        step(
            "link",
            Status::Pass,
            &format!("Connected through {name} with address {address}."),
        ),
    );

    let gateway = interface
        .gateway
        .as_ref()
        .and_then(|gateway| gateway.ipv4.first().copied());
    let router = match gateway {
        None => {
            record(
                &mut steps,
                step(
                    "router",
                    Status::Warn,
                    "No router address was found for this connection.",
                ),
            );
            Router::Unknown
        }
        Some(gateway) => match ping(IpAddr::V4(gateway)) {
            Some(true) => {
                record(
                    &mut steps,
                    step(
                        "router",
                        Status::Pass,
                        &format!("The router at {gateway} answered."),
                    ),
                );
                Router::Answered
            }
            Some(false) => {
                record(&mut steps, step(
                    "router",
                    Status::Warn,
                    &format!("The router at {gateway} did not answer. Some routers ignore this check."),
                ));
                Router::Silent
            }
            None => {
                record(
                    &mut steps,
                    step("router", Status::Warn, "Could not check the router."),
                );
                Router::Unknown
            }
        },
    };

    let addresses = resolve(PROBE.host);
    let dns_ok = !addresses.is_empty();
    if dns_ok {
        record(
            &mut steps,
            step(
                "dns",
                Status::Pass,
                &format!("Website names resolve ({} found).", PROBE.host),
            ),
        );
    } else {
        record(
            &mut steps,
            step(
                "dns",
                Status::Fail,
                &format!("Could not look up {}.", PROBE.host),
            ),
        );
    }

    let probe = if dns_ok {
        let probe = http_probe(&addresses);
        let (status, detail) = match &probe {
            Probe::Online => (Status::Pass, "The internet answered.".to_string()),
            Probe::SignInRequired => (
                Status::Warn,
                "A sign-in page answered instead of the internet.".to_string(),
            ),
            Probe::Offline(reason) => (
                Status::Fail,
                format!("The internet did not answer: {reason}"),
            ),
        };
        record(&mut steps, step("internet", status, &detail));
        probe
    } else {
        record(
            &mut steps,
            step(
                "internet",
                Status::Skipped,
                "Skipped: website names don't resolve.",
            ),
        );
        Probe::Offline("skipped".to_string())
    };

    let (verdict, summary) = summarize(true, router, dns_ok, &probe);
    Report {
        steps,
        verdict,
        summary,
    }
}

fn step(id: &'static str, status: Status, detail: &str) -> Step {
    Step {
        id,
        status,
        detail: detail.to_string(),
    }
}

/// Turn the step results into one plain-language conclusion. A working
/// internet connection wins over a silent router, because many routers simply
/// ignore ping.
pub fn summarize(link: bool, router: Router, dns: bool, probe: &Probe) -> (Verdict, String) {
    let (verdict, summary) = if !link {
        (
            Verdict::NoNetwork,
            "This computer isn't connected to a network. Check that Wi-Fi is on and joined to a network.",
        )
    } else if *probe == Probe::Online {
        (
            Verdict::Ok,
            "Everything looks fine: this computer is online.",
        )
    } else if *probe == Probe::SignInRequired {
        (
            Verdict::SignInRequired,
            "This network needs you to sign in. Open a web browser to see its sign-in page.",
        )
    } else if !dns && router == Router::Silent {
        (
            Verdict::RouterUnreachable,
            "You're connected to the network, but the router isn't answering. Try turning Wi-Fi off and on, or restart the router.",
        )
    } else if !dns {
        (
            Verdict::DnsBroken,
            "The network is up, but website names can't be looked up (DNS). Try reconnecting, or check the DNS settings.",
        )
    } else {
        (
            Verdict::NoInternet,
            "The local network works, but the internet isn't reachable through it. The connection beyond the router may be down.",
        )
    };
    (verdict, summary.to_string())
}

/// Resolve `host` with the system resolver, giving up after `DNS_TIMEOUT`.
fn resolve(host: &'static str) -> Vec<SocketAddr> {
    let (sender, receiver) = mpsc::channel();
    // The system resolver has no timeout of its own; a stuck lookup thread
    // is simply abandoned.
    std::thread::spawn(move || {
        let addresses = (host, 80)
            .to_socket_addrs()
            .map(|addresses| addresses.collect::<Vec<_>>())
            .unwrap_or_default();
        let _ = sender.send(addresses);
    });
    receiver.recv_timeout(DNS_TIMEOUT).unwrap_or_default()
}

/// Fetch the probe page over plain HTTP and classify the answer.
fn http_probe(addresses: &[SocketAddr]) -> Probe {
    let mut last_error = "no address to connect to".to_string();
    for address in addresses.iter().take(2) {
        match fetch(address) {
            Ok(response) => return classify_probe(&response, PROBE.expected),
            Err(error) => last_error = error.to_string(),
        }
    }
    Probe::Offline(last_error)
}

fn fetch(address: &SocketAddr) -> std::io::Result<Vec<u8>> {
    let mut stream = TcpStream::connect_timeout(address, CONNECT_TIMEOUT)?;
    stream.set_read_timeout(Some(IO_TIMEOUT))?;
    stream.set_write_timeout(Some(IO_TIMEOUT))?;
    write!(
        stream,
        "GET {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: WiLens\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
        PROBE.path, PROBE.host
    )?;
    let mut response = Vec::new();
    // A portal that keeps the connection open still leaves a usable partial
    // response, so a read timeout after some data is not an error.
    match stream.take(MAX_RESPONSE_BYTES).read_to_end(&mut response) {
        Ok(_) => Ok(response),
        Err(_) if !response.is_empty() => Ok(response),
        Err(error) => Err(error),
    }
}

/// Classify a raw HTTP response to the probe page. Only an HTTP 200 carrying
/// the expected text means online; any other HTTP answer (a redirect, a 511,
/// a different page) means a sign-in page is in the way.
pub fn classify_probe(response: &[u8], expected: &str) -> Probe {
    let text = String::from_utf8_lossy(response);
    let Some(status_line) = text.lines().next().filter(|line| line.starts_with("HTTP/")) else {
        return Probe::Offline("no valid response".to_string());
    };
    let code = status_line.split_whitespace().nth(1).unwrap_or_default();
    let body = text.split_once("\r\n\r\n").map_or("", |(_, body)| body);
    if code == "200" && body.contains(expected) {
        Probe::Online
    } else {
        Probe::SignInRequired
    }
}

/// Ping `address` with the system `ping` tool. `None` when ping could not run.
#[cfg(target_os = "macos")]
fn ping(address: IpAddr) -> Option<bool> {
    use std::process::Command;

    let output = crate::process::run_with_timeout(
        Command::new("/sbin/ping").args(["-c", "2", "-t", "4", &address.to_string()]),
        Duration::from_secs(8),
        "ping",
    )
    .ok()?;
    Some(output.status.success())
}

#[cfg(windows)]
fn ping(address: IpAddr) -> Option<bool> {
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let program = std::path::Path::new(&system_root)
        .join("System32")
        .join("PING.EXE");
    let output = crate::process::run_with_timeout(
        Command::new(program)
            .args(["-n", "2", "-w", "1500", &address.to_string()])
            .creation_flags(CREATE_NO_WINDOW),
        Duration::from_secs(8),
        "ping",
    )
    .ok()?;
    Some(windows_ping_replied(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

#[cfg(not(any(target_os = "macos", windows)))]
fn ping(_address: IpAddr) -> Option<bool> {
    None
}

/// Windows ping exits 0 even when another host reports "destination
/// unreachable", so look for an actual echo reply, which always carries TTL.
#[cfg_attr(not(windows), allow(dead_code))]
pub fn windows_ping_replied(output: &str) -> bool {
    output.to_ascii_uppercase().contains("TTL=")
}

#[cfg(test)]
mod tests {
    use super::{classify_probe, summarize, windows_ping_replied, Probe, Router, Verdict};

    const APPLE_OK: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>";

    #[test]
    fn expected_page_means_online() {
        assert_eq!(classify_probe(APPLE_OK, "Success"), Probe::Online);
    }

    #[test]
    fn redirects_and_other_pages_mean_a_sign_in_page() {
        let redirect = b"HTTP/1.1 302 Found\r\nLocation: http://portal.example/login\r\n\r\n";
        let other_page = b"HTTP/1.1 200 OK\r\n\r\n<html>Welcome! Accept the terms</html>";
        let network_auth = b"HTTP/1.1 511 Network Authentication Required\r\n\r\n";
        for response in [&redirect[..], &other_page[..], &network_auth[..]] {
            assert_eq!(classify_probe(response, "Success"), Probe::SignInRequired);
        }
    }

    #[test]
    fn garbage_is_not_mistaken_for_a_portal() {
        assert!(matches!(classify_probe(b"", "Success"), Probe::Offline(_)));
        assert!(matches!(
            classify_probe(b"\x16\x03\x01 tls", "Success"),
            Probe::Offline(_)
        ));
    }

    #[test]
    fn summary_follows_the_first_broken_layer() {
        let offline = Probe::Offline("timed out".to_string());
        assert_eq!(
            summarize(false, Router::Unknown, false, &offline).0,
            Verdict::NoNetwork
        );
        assert_eq!(
            summarize(true, Router::Silent, false, &offline).0,
            Verdict::RouterUnreachable
        );
        assert_eq!(
            summarize(true, Router::Answered, false, &offline).0,
            Verdict::DnsBroken
        );
        assert_eq!(
            summarize(true, Router::Answered, true, &offline).0,
            Verdict::NoInternet
        );
        assert_eq!(
            summarize(true, Router::Answered, true, &Probe::SignInRequired).0,
            Verdict::SignInRequired
        );
    }

    #[test]
    fn working_internet_outranks_a_router_that_ignores_ping() {
        assert_eq!(
            summarize(true, Router::Silent, true, &Probe::Online).0,
            Verdict::Ok
        );
    }

    #[test]
    fn windows_ping_needs_a_real_reply() {
        assert!(windows_ping_replied(
            "Reply from 192.168.1.1: bytes=32 time=2ms TTL=64"
        ));
        assert!(!windows_ping_replied(
            "Reply from 192.168.1.23: Destination host unreachable."
        ));
    }
}

/// Runs the real check against this machine's network. Ignored by default
/// because it needs a network; run with `cargo test live_check -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn live_check() {
        let report = super::run(&|step| println!("{:?}", step));
        println!("{:?}: {}", report.verdict, report.summary);
    }
}
