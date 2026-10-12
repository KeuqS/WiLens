use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

mod netsh;
#[cfg(any(target_os = "macos", windows))]
mod process;
#[cfg(target_os = "macos")]
mod wifi;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinWifiRequest {
    ssid: String,
    password: Option<String>,
    security: String,
    #[serde(default)]
    hidden: bool,
}

// Hand-written so a stray `{:?}` can never put the password in a log.
impl std::fmt::Debug for JoinWifiRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JoinWifiRequest")
            .field("ssid", &self.ssid)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("security", &self.security)
            .field("hidden", &self.hidden)
            .finish()
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct JoinWifiResponse {
    interface: String,
    message: String,
    method: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorResponse {
    message: String,
}

#[tauri::command]
async fn join_wifi(
    request: JoinWifiRequest,
    on_progress: Channel<String>,
) -> Result<JoinWifiResponse, ErrorResponse> {
    // Scans, association, verification polling, and external processes can
    // all block for seconds. Run them on Tauri's dedicated blocking pool so the
    // event loop keeps servicing the window instead of freezing it.
    tauri::async_runtime::spawn_blocking(move || {
        let progress = |message: &str| {
            let _ = on_progress.send(message.to_string());
        };
        join_wifi_blocking(request, &progress)
    })
    .await
    .map_err(|error| ErrorResponse {
        message: format!("Wi-Fi join task ended unexpectedly: {error}"),
    })?
}

/// Outcome of a platform join.
struct Joined {
    interface: String,
    method: &'static str,
    /// False when the OS accepted the join but could not confirm the
    /// connection came up.
    verified: bool,
}

fn join_wifi_blocking(
    request: JoinWifiRequest,
    progress: &dyn Fn(&str),
) -> Result<JoinWifiResponse, ErrorResponse> {
    let ssid = sanitize_required(&request.ssid, "SSID")?;
    let security = normalize_security(&request.security)?;
    let password = sanitize_optional(request.password.as_deref(), "Password")?;

    let joined = join_platform(
        &ssid,
        &security,
        password.as_deref(),
        request.hidden,
        progress,
    )?;
    log::info!(
        "Joined '{ssid}' via {} on {} (verified: {})",
        joined.method,
        joined.interface,
        joined.verified
    );

    let message = if joined.verified {
        format!("Joined '{ssid}' successfully.")
    } else {
        format!(
            "Asked the system to join '{ssid}', but it could not confirm the connection. Check the Wi-Fi icon to be sure."
        )
    };

    Ok(JoinWifiResponse {
        interface: joined.interface,
        message,
        method: joined.method.to_string(),
    })
}

#[cfg(target_os = "macos")]
fn join_platform(
    ssid: &str,
    security: &str,
    password: Option<&str>,
    _hidden: bool,
    progress: &dyn Fn(&str),
) -> Result<Joined, ErrorResponse> {
    use wifi::CoreWlanError;

    let corewlan_result = if wifi::location_denied() {
        Err(CoreWlanError::Unavailable(
            "Location access is denied, so CoreWLAN cannot scan.".to_string(),
        ))
    } else {
        wifi::join_via_corewlan(ssid, security, password, progress)
    };

    match corewlan_result {
        Ok(interface) => Ok(Joined {
            interface,
            method: "corewlan",
            verified: true,
        }),
        // The network itself refused the join; networksetup would only repeat
        // the same failure after another long wait.
        Err(CoreWlanError::Rejected(message)) => Err(ErrorResponse { message }),
        Err(CoreWlanError::Unavailable(corewlan_error)) => {
            log::warn!("CoreWLAN join failed, falling back to networksetup: {corewlan_error}");
            ensure_not_flag(ssid, "SSID")?;
            if let Some(password) = password {
                ensure_not_flag(password, "Password")?;
            }
            // networksetup stores whatever password it is given, so a QR code
            // naming a network the user already saved could replace their
            // working password. Leave saved networks to macOS.
            if wifi::is_saved_network(ssid) {
                return Err(ErrorResponse {
                    message: format!(
                        "'{ssid}' is already saved on this Mac. Pick it from the Wi-Fi menu, or allow Location access for WiLens so it can join safely."
                    ),
                });
            }
            progress("Trying the system fallback...");
            let interface = wifi::join_via_networksetup(ssid, security, password)
                .map_err(|message| ErrorResponse { message })?;
            // The SSID is unreadable without Location access, so the join can
            // only be confirmed when it is readable and matches. networksetup
            // cannot be told the security type, so check that afterwards too.
            let verified = match wifi::default_interface_ssid() {
                Some(current) if current != ssid => {
                    return Err(ErrorResponse {
                        message: format!(
                            "Could not join '{ssid}'; still connected to '{current}'."
                        ),
                    });
                }
                Some(_) => {
                    if !wifi::current_security_matches(security) {
                        return Err(ErrorResponse {
                            message: format!(
                                "Joined a network named '{ssid}', but it does not use the security the QR code declares. Check the Wi-Fi menu before using it."
                            ),
                        });
                    }
                    true
                }
                None => false,
            };
            Ok(Joined {
                interface,
                method: "networksetup",
                verified,
            })
        }
    }
}

#[cfg(windows)]
fn join_platform(
    ssid: &str,
    security: &str,
    password: Option<&str>,
    hidden: bool,
    progress: &dyn Fn(&str),
) -> Result<Joined, ErrorResponse> {
    let joined = netsh::join_via_netsh(ssid, security, password, hidden, progress)
        .map_err(|message| ErrorResponse { message })?;
    Ok(Joined {
        interface: joined.interface,
        method: "netsh",
        verified: joined.verified,
    })
}

#[cfg(not(any(target_os = "macos", windows)))]
fn join_platform(
    _ssid: &str,
    _security: &str,
    _password: Option<&str>,
    _hidden: bool,
    _progress: &dyn Fn(&str),
) -> Result<Joined, ErrorResponse> {
    Err(ErrorResponse {
        message: "Joining Wi-Fi is not supported on this platform yet.".to_string(),
    })
}

fn sanitize_required(value: &str, label: &str) -> Result<String, ErrorResponse> {
    if value.trim().is_empty() {
        return Err(ErrorResponse {
            message: format!("{label} is required."),
        });
    }

    if value
        .chars()
        .any(|char| char == '\0' || char == '\n' || char == '\r')
    {
        return Err(ErrorResponse {
            message: format!("{label} contains invalid control characters."),
        });
    }

    Ok(value.to_string())
}

#[cfg(target_os = "macos")]
/// networksetup receives values as positional arguments. A value that begins
/// with '-' would be misread as a command-line flag (argument injection), so
/// the fallback refuses it. CoreWLAN takes values directly and needs no check.
fn ensure_not_flag(value: &str, label: &str) -> Result<(), ErrorResponse> {
    if value.starts_with('-') {
        return Err(ErrorResponse {
            message: format!(
                "Could not join with CoreWLAN, and the fallback cannot use a {label} starting with '-'."
            ),
        });
    }
    Ok(())
}

fn sanitize_optional(value: Option<&str>, label: &str) -> Result<Option<String>, ErrorResponse> {
    match value {
        Some(raw) if !raw.is_empty() => sanitize_required(raw, label).map(Some),
        _ => Ok(None),
    }
}

fn normalize_security(value: &str) -> Result<String, ErrorResponse> {
    let normalized = value.trim().to_ascii_lowercase();

    match normalized.as_str() {
        "wpa" | "wep" | "nopass" => Ok(normalized),
        _ => Err(ErrorResponse {
            message: format!("Unsupported security type '{value}'."),
        }),
    }
}

#[cfg(target_os = "macos")]
fn request_location_authorization() {
    use objc2_core_location::CLLocationManager;
    unsafe {
        let manager = CLLocationManager::new();
        manager.requestWhenInUseAuthorization();
        // Keep the manager alive for the app's lifetime so the asynchronous
        // authorization prompt can complete.
        std::mem::forget(manager);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::default().build())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            request_location_authorization();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![join_wifi])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::ensure_not_flag;
    use super::{normalize_security, sanitize_optional, sanitize_required};

    #[test]
    fn sanitize_required_accepts_a_normal_value() {
        assert_eq!(sanitize_required("MyWifi", "SSID").unwrap(), "MyWifi");
    }

    #[test]
    fn sanitize_required_rejects_empty_and_whitespace() {
        assert!(sanitize_required("", "SSID").is_err());
        assert!(sanitize_required("   ", "SSID").is_err());
    }

    #[test]
    fn sanitize_required_rejects_control_characters() {
        assert!(sanitize_required("My\nWifi", "SSID").is_err());
        assert!(sanitize_required("My\0Wifi", "SSID").is_err());
        assert!(sanitize_required("My\rWifi", "SSID").is_err());
    }

    #[test]
    fn sanitize_required_accepts_leading_dash() {
        // Valid for CoreWLAN; only the networksetup fallback refuses it.
        assert_eq!(sanitize_required("-pass", "Password").unwrap(), "-pass");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn ensure_not_flag_rejects_leading_dash() {
        assert!(ensure_not_flag("-setairportpower", "SSID").is_err());
        assert!(ensure_not_flag("MyWifi", "SSID").is_ok());
    }

    #[test]
    fn sanitize_optional_maps_present_and_absent_values() {
        assert_eq!(
            sanitize_optional(Some("pw"), "Password").unwrap(),
            Some("pw".to_string())
        );
        assert_eq!(sanitize_optional(Some(""), "Password").unwrap(), None);
        assert_eq!(sanitize_optional(None, "Password").unwrap(), None);
    }

    #[test]
    fn normalize_security_accepts_supported_types() {
        assert_eq!(normalize_security("WPA").unwrap(), "wpa");
        assert_eq!(normalize_security("wep").unwrap(), "wep");
        assert_eq!(normalize_security(" nopass ").unwrap(), "nopass");
    }

    #[test]
    fn debug_output_redacts_the_password() {
        let request = super::JoinWifiRequest {
            ssid: "Cafe".to_string(),
            password: Some("secret-pass".to_string()),
            security: "wpa".to_string(),
            hidden: false,
        };
        let debug = format!("{request:?}");
        assert!(debug.contains("Cafe"));
        assert!(!debug.contains("secret-pass"));
    }

    #[test]
    fn normalize_security_rejects_unsupported_types() {
        assert!(normalize_security("wpa3-enterprise").is_err());
        assert!(normalize_security("").is_err());
    }
}
