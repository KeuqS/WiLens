# WiLens TODO

## Phase 0: Project Setup

- [x] Initialize the Tauri project with a TypeScript frontend.
- [x] Confirm the app builds locally on macOS.
- [x] Add basic project metadata, app name, and bundle identifiers.
- [x] Replace the default template with a minimal custom UI.

## Phase 1: QR Scanning MVP

- [x] Add a browser-based QR scanning library such as `@zxing/browser`.
- [x] Build a small single-screen UI with camera preview.
- [x] Request camera permission and handle denial cleanly.
- [x] Detect and scan QR codes continuously from the live camera stream.
- [x] Stop scanning once a valid Wi-Fi QR payload is found.

## Phase 2: QR Parsing

- [x] Create `src/qr.ts` for Wi-Fi QR parsing.
- [x] Support the standard format: `WIFI:T:<type>;S:<ssid>;P:<password>;;`
- [x] Validate required fields before calling Rust.
- [x] Handle escaped characters and malformed payloads defensively.
- [x] Show the parsed SSID, security type, and password state before joining.

## Phase 3: macOS Wi-Fi Join

- [x] Create a Tauri command in Rust for joining Wi-Fi.
- [x] Detect the Wi-Fi interface in Rust before running `networksetup`.
- [x] Call `networksetup -setairportnetwork`. *(now only a fallback for open networks; see Phase 8)*
- [x] Capture stdout, stderr, and exit status.
- [x] Return structured error messages to the frontend.

## Phase 4: UI Flow

- [x] Show a scan result card with SSID and security type.
- [x] Require explicit user confirmation before joining.
- [x] Show pending, success, and failure states.
- [x] Add a retry path after failed scans or failed join attempts.
- [x] Add a manual copy-password fallback.

## Phase 5: Testing

- [ ] Test with WPA/WPA2 QR codes.
- [ ] Test with open network QR codes.
- [ ] Test malformed and partial QR strings.
- [ ] Test camera permission denied on first launch.
- [ ] Test `networksetup` behavior on the target macOS version.
- [ ] Verify behavior when the machine is already connected to another network.

## Phase 6: Hardening

- [x] Prevent duplicate join attempts while a connection request is in flight.
- [x] Avoid logging raw passwords.
- [x] Sanitize command inputs before invoking shell commands.
- [x] Add frontend validation and backend validation for defense in depth.
- [x] Document macOS limitations and expected permissions.

## Nice-to-Have

- [x] Auto-detect the Wi-Fi interface. *(`detect_wifi_interface` in `wifi.rs`)*
- [ ] Add optional native scanning research with `nokhwa` and Vision.
- Recent scans, connection history, and a recent-networks screen are moved to
  [Deliberately postponed](#deliberately-postponed): they mean storing network
  names on disk, which the privacy promise currently rules out.

## Known Behavior

- [x] `networksetup` may trigger a macOS administrator or keychain approval prompt during join.
- [x] Reduce the prompt: CoreWLAN joins quietly, and `networksetup` now only runs for open networks when Location is denied.

## Definition of Done for MVP

- [x] App launches as a Tauri desktop window on macOS.
- [x] Camera preview works.
- [x] A standard Wi-Fi QR code can be scanned.
- [x] Parsed network details are shown before joining.
- [x] The app attempts Wi-Fi join through Rust successfully.
- [x] Errors are understandable enough to debug field issues.

---

## Phase 7: Post-Review Improvements

Derived from the engineering / security / design review (2026-06-19).
Business items intentionally dropped — WiLens is an open-source utility.

### 7a. Testing (highest risk: zero coverage on the most logic-heavy code)

- [x] Add a test runner (Vitest) to the frontend.
- [x] Test `parseWifiQr` with WPA/WPA2 payloads.
- [x] Test `parseWifiQr` with open (`nopass`) networks.
- [x] Test escaped characters in SSID/password (`\;`, `\:`, `\\`, `\,`).
- [x] Test malformed / partial QR strings (missing `WIFI:`, missing SSID, missing password, bad security type).
- [x] Add Rust unit tests for `sanitize_required`, `sanitize_optional`, `normalize_security`.
- [x] Improve open-network handling: infer missing/empty `T` from password presence instead of defaulting to WPA.

### 7b. Reliability

- [x] Verify `networksetup -setairportnetwork` works on the target macOS version. *(kept as fallback; primary join now uses CoreWLAN)*
- [x] Document the `Copy password` manual fallback as the supported Plan B if the join command fails. *(already in `docs/usage.md`)*
- [x] Replace the per-join admin prompt by joining via CoreWLAN; request Location permission at startup; fall back to networksetup. *(see `docs/superpowers/specs/2026-06-20-corewlan-join-design.md`)*

### 7c. Security hardening

- [x] Set a restrictive CSP in `tauri.conf.json` (replace `"csp": null`).
- [x] Reject SSID/password values beginning with `-` to prevent `networksetup` argument injection.
- [x] Run a dependency audit. *(remaining advisories are dev-only transitive deps — vite/vitest → picomatch — not shipped in the app)*

### 7d. Frontend / accessibility

- [x] Add `aria-live="polite"` to the `#status` element so screen readers announce scan/join results.

### 7e. Landing page

- [x] Replace the dead `githubHref = "#"` links with the real repo URL (or remove them).
- [x] Delete the leftover commented-out `signal-logo` markup.
- [x] Fix the broken favicon reference (`/app-logo.svg` did not exist) and wire in the new brand assets.

### 7f. Tooling / CI

- [x] Add a CI workflow: `tsc --noEmit`, `vitest`, `cargo test`, `cargo clippy`.

---

## Phase 8: Security Audit Fixes (done)

From the full security audit (2026-10-12, report in `~/security-audit-skill/WiLens/run-1/`). Shipped in #52.

- [x] Windows: reject `*` and `?` in network names so a failed join can't run `netsh wlan delete profile name=*`.
- [x] Windows: never overwrite or delete a profile that already existed; roll back only profiles this join created.
- [x] macOS: only join a scanned network whose security matches the QR code (no same-name "evil twin" with weaker security).
- [x] macOS: limit the `networksetup` fallback to open networks (no password on its command line, no unchecked joins).
- [x] Windows: reconnect through the profile instead of trusting "already connected" by name.
- [x] Redact the password from `Debug` output; reveal hidden bidi / zero-width characters in SSIDs.
- [x] Drop `'unsafe-inline'` from the production CSP (kept in `devCsp`).
- [x] CI: read-only tokens by default, SHA-pinned actions, release-only write jobs, `video/` audited.
- [x] Release checksums; macOS workflow ready to sign and notarize once secrets exist.

## Phase 9: Share a Network (done)

Shipped in #56.

- [x] Join / Share mode switch.
- [x] Build `WIFI:` payloads with validation (SSID ≤ 32 bytes, WPA / WEP key formats) and escaping.
- [x] Live QR preview with the network name printed under the code (password never drawn as text).
- [x] Save as PNG through a Rust-side save dialog (no new webview permissions).
- [x] Round-trip tests: build → parse, and encode → decode.

## Phase 10: Connection Check (done, landing)

Reviewed in #57; landing on `main` via #58.

- [x] Check link, router, DNS, and internet in order, streaming each step to the UI.
- [x] Detect sign-in (captive) pages with the OS's own probe page.
- [x] One plain-language verdict; a router that ignores ping doesn't fail the check on its own.
- [x] Copy a report with no passwords or network names.
- [x] Privacy docs describe exactly which hosts the check contacts and when.

---

# Roadmap

Direction: **Connect, Share, Check** — the simplest open-source way to get a
computer onto Wi-Fi, share it, and understand why it isn't working. Keep the
app small, local-first, and account-free. Each phase should ship on its own.

## Phase 11: Release & Trust (next)

The biggest barrier to new users is installing an unsigned app.

- [ ] Get an Apple Developer ID and add the `APPLE_*` secrets so `build-macos.yml` signs and notarizes `WiLens.dmg`.
- [ ] Run the `macOS build` workflow once by hand before the next release.
- [ ] Remove the "Open Anyway" / `xattr` instructions from the README and landing page once releases are notarized.
- [ ] Windows: sign the installer (or document SmartScreen honestly until then).
- [ ] Publish a Homebrew cask (`brew install --cask wilens`).
- [ ] Publish to winget once the Windows build is no longer experimental.
- [ ] Record a new demo GIF covering Join, Share, and Check.
- [ ] Release notes for each version (what changed, what to test).

## Phase 12: Real-Device Testing

Several behaviors depend on the OS and can't be proven in CI.

- [ ] macOS: join WPA2, WPA3, WEP, and open networks with Location allowed.
- [ ] macOS: with Location denied, a secured QR shows the Location message and an open one joins.
- [ ] macOS: a same-name open network is refused when the QR declares WPA.
- [ ] Windows 10 and 11: first join creates a profile; re-scan reuses it; a saved profile is never overwritten.
- [ ] Windows: a network name with `*` or `?` is refused.
- [ ] Windows 11 24H2 with Location denied: join reports "could not confirm" and doesn't delete the profile.
- [ ] Share: save a PNG, scan it with iPhone and Android cameras, and confirm both offer to join.
- [ ] Check: working network, Wi-Fi off, router unplugged from the internet, and a hotel/café sign-in page.
- [ ] Turn the results into a short `docs/testing.md` checklist for each release.

## Phase 13: Connect Improvements

- [ ] Scan a QR code from an image file, the clipboard, or drag-and-drop (no camera needed).
- [ ] Scan a QR code shown on screen (e.g. a code in a chat or a PDF).
- [ ] After a failed join, offer **Check connection** with one click.
- [ ] Windows: support WPA3-only networks (`WPA3SAE` profile) where the OS allows it.
- [ ] Windows: replace `netsh` with the Native Wifi API (`WlanSetProfile`, `WlanConnect`) for non-localized results and literal profile names.
- [ ] macOS: handle hidden networks explicitly (`includeHidden` scan plus a clearer "not found" message).
- [ ] Explain common failures in plain language (wrong password, network out of range, enterprise network not supported).

## Phase 14: Share Improvements

- [ ] Copy the QR image to the clipboard.
- [ ] Printable card layout (network name, QR code, optional "scan to join" text).
- [ ] "Share the network I'm on" — read the current SSID, and the password only after an explicit keychain prompt. Never store it.
- [ ] Show the payload text for people who want to paste it elsewhere (behind a "show details" toggle).

## Phase 15: Check Improvements

- [ ] **Open sign-in page** button for captive portals (opens the system browser to a fixed probe URL, no arbitrary links).
- [ ] Detect an active VPN and say when it may be the cause.
- [ ] Check IPv6 connectivity separately.
- [ ] Show Wi-Fi signal strength and channel when the OS reports them (no spectrum analysis).
- [ ] Re-run individual steps; show how long each took.
- [ ] Suggest next steps for each verdict (restart router, forget and rejoin, contact the network owner).

## Phase 16: Contributors & Community

- [ ] `CONTRIBUTING.md`: setup, tests, coding style, how to propose features.
- [ ] Issue templates: bug report (with Copy report output), feature request, platform compatibility.
- [ ] Label and publish good first issues, for example:
  - [ ] Add parser tests for unusual payloads (`WIFI:` with fields in any order, trailing spaces, empty `H:`).
  - [ ] Add property-based / fuzz tests for `parseWifiQr` and `buildWifiQr` round-trips.
  - [ ] Add keyboard shortcuts for the three modes.
  - [ ] Improve focus styles and screen-reader labels (accessibility pass).
- [ ] Localization: extract UI strings and accept translations.
- [ ] A lightweight public roadmap (this file, linked from the README).

## Phase 17: Later

- [ ] Linux support (NetworkManager) once macOS and Windows are dependable.
- [ ] Share via a temporary local web page for devices without a camera.

## Deliberately postponed

Not ruled out, but only if users ask for them repeatedly:

- Saved password vault, recent scans, or connection history — means storing secrets or network names on disk.
- Always-on background monitoring — needs background activity and more permissions.
- Full Wi-Fi spectrum analyzer — specialist tools already do this.
- Local file transfer — a different product category (see LocalSend).
- AI network assistant — complexity before a proven need.
- Telemetry or analytics — conflicts with the privacy promise; use GitHub release stats and opt-in feedback instead.
