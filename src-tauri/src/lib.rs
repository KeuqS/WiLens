use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

mod diagnose;
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

/// Run the connection check, sending each step to the UI as it finishes.
/// Pings and DNS lookups block for seconds, so they run on the blocking pool.
#[tauri::command]
async fn check_connection(
    on_step: Channel<diagnose::Step>,
) -> Result<diagnose::Report, ErrorResponse> {
    tauri::async_runtime::spawn_blocking(move || {
        diagnose::run(&|step| {
            let _ = on_step.send(step.clone());
        })
    })
    .await
    .map_err(|error| ErrorResponse {
        message: format!("The connection check ended unexpectedly: {error}"),
    })
}

/// Largest QR image the frontend may ask to save. A rendered Wi-Fi QR code is a
/// few tens of kilobytes; the cap only stops a runaway buffer.
const MAX_QR_IMAGE_BYTES: usize = 4 * 1024 * 1024;

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];

/// Ask the user where to save a generated Wi-Fi QR code and write it there.
/// The save dialog runs on the Rust side, so the webview never chooses a path
/// and needs no file-system or dialog permissions. Returns false if the user
/// cancels.
#[tauri::command]
async fn save_qr_image(
    app: tauri::AppHandle,
    png: Vec<u8>,
    suggested_name: String,
) -> Result<bool, ErrorResponse> {
    if png.len() > MAX_QR_IMAGE_BYTES || !png.starts_with(&PNG_SIGNATURE) {
        return Err(ErrorResponse {
            message: "The QR code image is not a valid PNG.".to_string(),
        });
    }
    let file_name = format!("{}.png", safe_file_stem(&suggested_name));

    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;

        let Some(choice) = app
            .dialog()
            .file()
            .add_filter("PNG image", &["png"])
            .set_file_name(file_name)
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let mut path = choice.into_path().map_err(|error| ErrorResponse {
            message: format!("Could not use that location: {error}"),
        })?;
        if path.extension().is_none() {
            path.set_extension("png");
        }
        std::fs::write(&path, &png).map_err(|error| ErrorResponse {
            message: format!("Could not save the QR code: {error}"),
        })?;
        Ok(true)
    })
    .await
    .map_err(|error| ErrorResponse {
        message: format!("Saving the QR code ended unexpectedly: {error}"),
    })?
}

/// A file name stem from a network name: letters, digits, spaces, '-' and '_'
/// only, so nothing in an SSID can steer the suggested path.
fn safe_file_stem(name: &str) -> String {
    let stem: String = name
        .chars()
        .filter(|char| char.is_alphanumeric() || matches!(char, ' ' | '-' | '_'))
        .take(48)
        .collect();
    let stem = stem.trim();
    if stem.is_empty() {
        "wifi-qr".to_string()
    } else {
        format!("wifi-{stem}")
    }
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

    let location_denied = wifi::location_denied();
    let corewlan_result = if location_denied {
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
        // networksetup can neither check a network's security nor take a
        // password except as a command-line argument, so it is only used for
        // open networks. Secured networks need the CoreWLAN path, which picks
        // a network whose security matches the QR code.
        Err(CoreWlanError::Unavailable(corewlan_error)) if security != "nopass" => {
            log::warn!("CoreWLAN join failed for a secured network: {corewlan_error}");
            Err(ErrorResponse {
                message: if location_denied {
                    format!(
                        "Joining a secured network needs Location access, so WiLens can check that '{ssid}' is the network in the QR code. Allow WiLens in System Settings > Privacy & Security > Location Services, or copy the password and join from the Wi-Fi menu."
                    )
                } else {
                    corewlan_error
                },
            })
        }
        Err(CoreWlanError::Unavailable(corewlan_error)) => {
            log::warn!("CoreWLAN join failed, falling back to networksetup: {corewlan_error}");
            ensure_not_flag(ssid, "SSID")?;
            progress("Trying the system fallback...");
            let interface =
                wifi::join_via_networksetup(ssid).map_err(|message| ErrorResponse { message })?;
            // The SSID is unreadable without Location access, so the join can
            // only be confirmed when it is readable and matches.
            let verified = match wifi::default_interface_ssid() {
                Some(current) if current != ssid => {
                    return Err(ErrorResponse {
                        message: format!(
                            "Could not join '{ssid}'; still connected to '{current}'."
                        ),
                    });
                }
                Some(_) => true,
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
        .plugin(tauri_plugin_dialog::init())
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            request_location_authorization();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            join_wifi,
            save_qr_image,
            check_connection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "macos")]
    use super::ensure_not_flag;
    use super::{normalize_security, safe_file_stem, sanitize_optional, sanitize_required};

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
    fn safe_file_stem_keeps_only_plain_characters() {
        assert_eq!(safe_file_stem("Cafe Upstairs"), "wifi-Cafe Upstairs");
        assert_eq!(safe_file_stem("../../etc/passwd"), "wifi-etcpasswd");
        assert_eq!(safe_file_stem("***"), "wifi-qr");
        assert_eq!(safe_file_stem(""), "wifi-qr");
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
