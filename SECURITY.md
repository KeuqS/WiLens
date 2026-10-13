# WiLens Security & Privacy

WiLens is a small, open-source macOS utility that scans a Wi‑Fi QR code with your
camera and joins the network for you. This page explains exactly what it does,
what it does **not** do, and how we keep it safe — so you can install it with
confidence.

**TL;DR:** WiLens runs entirely on your Mac. It has no servers, no accounts, and
no analytics. Its only network traffic is the connection check, which runs only
when you click **Run check**. Your camera images, Wi‑Fi names, and passwords
never leave your computer. The full source code is in this repository.

---

## What WiLens does

1. Opens your Mac's camera (with your permission) to look for a Wi‑Fi QR code.
2. Reads the standard `WIFI:` QR payload (network name, password, security type).
3. Asks macOS to join that network using Apple's built-in CoreWLAN API.
4. Optionally makes a Wi‑Fi QR code from details you type, and saves it as an
   image where you choose.
5. Optionally checks your connection when you click **Run check**: it pings your
   router and sends one plain HTTP request for a tiny page at
   `captive.apple.com` (Windows: `www.msftconnecttest.com`), the address the
   operating system itself uses to detect sign-in pages. The request carries no
   information about you, your networks, or your passwords.

There is no cloud component.

## What WiLens does NOT do

- ❌ **No tracking.** No analytics, telemetry, ads, or crash reporting.
- ❌ **No accounts.** No sign-up, login, or email collection.
- ❌ **No data collection.** Camera frames, network names, and passwords are
  processed in memory on your Mac and are never uploaded anywhere.
- ❌ **No background activity.** It only does something while the window is open
  and you press a button.
- ❌ **No location tracking.** macOS *requires* Location permission before **any**
  app is allowed to read Wi‑Fi network details — this is an Apple OS rule, not a
  WiLens feature. WiLens never reads, stores, or transmits your location.

---

## Permissions it asks for, and why

| Permission | Why it's needed | Declared in |
|-----------|-----------------|-------------|
| **Camera** | To scan the Wi‑Fi QR code. | [`Info.plist`](src-tauri/Info.plist) → `NSCameraUsageDescription` |
| **Location (While Using)** | macOS blocks reading Wi‑Fi network details unless Location is granted. Used only to find and join the network you scanned. | [`Info.plist`](src-tauri/Info.plist) → `NSLocationWhenInUseUsageDescription` |

You can revoke either permission at any time in **System Settings → Privacy &
Security**.

---

## How your data is handled

- **Camera images** are decoded locally by the QR scanner in your Mac's browser
  engine and discarded immediately. They are never saved to disk or sent over a
  network.
- **Wi‑Fi passwords** are passed straight to macOS to join the network. WiLens
  does **not** log them — application logs record only the network name and which
  join method was used (see [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)).
- The connection is added to your Mac's normal Wi‑Fi settings, exactly as if you
  had typed it in yourself.

---

## How WiLens is built to be safe

WiLens is a [Tauri](https://tauri.app) app: a Rust core with a sandboxed web
front-end. We apply several layers of defense:

- **No remote code.** A strict Content Security Policy (`script-src 'self'`) means
  the app can only run code shipped inside it — it cannot load or execute scripts
  from the internet. (See [`tauri.conf.json`](src-tauri/tauri.conf.json).)
- **Minimal capabilities.** The front-end is granted only Tauri's default
  permissions — no file-system, shell, or arbitrary-network access. Saving a QR
  image and the connection check run in Rust behind narrow, typed commands; the
  front-end cannot choose a file path or a host to contact.
  (See [`src-tauri/capabilities/default.json`](src-tauri/capabilities/default.json).)
- **Input is sanitized.** Data read from a QR code is untrusted, so the Rust core
  validates it before use: it rejects control characters and values that could be
  misread as command-line flags (argument injection), and only allows known
  Wi‑Fi security types. (See `sanitize_required` / `normalize_security` in
  [`src-tauri/src/lib.rs`](src-tauri/src/lib.rs).)
- **No string-built shell commands.** When the system join helper is used, every
  value is passed as a separate, escaped argument — never concatenated into a
  shell string.
- **No secrets in the code.** There are no API keys, tokens, or passwords in the
  source or build.

## Keeping dependencies safe

- Every push and pull request runs an automated **dependency vulnerability audit**
  (`bun audit` for the front-end, `cargo audit` for Rust) in
  [CI](.github/workflows/ci.yml). As of the latest run, **0 known vulnerabilities**.
- **Dependabot** ([`.github/dependabot.yml`](.github/dependabot.yml)) opens
  automatic update PRs weekly for npm, Cargo, and GitHub Actions dependencies.
- The continuous-integration pipeline also runs type checks, linting
  (`cargo clippy -D warnings`), and the full test suite on every change.

---

## "Is this a scam / malware?"

It's a fair question to ask of any app you download. Here's how you can verify
WiLens yourself:

- **Read the code.** The entire app is open source in this repository — it's small
  enough to review in an afternoon. The core logic is a few hundred lines of Rust
  and TypeScript.
- **Build it yourself.** You don't have to trust our download. Clone the repo and
  run `bun install && cargo tauri build` to produce your own copy.
- **Check the network.** Run it behind Little Snitch / LuLu (or
  `nettop`) and you'll see WiLens makes no outbound connections of its own.
- **No installer tricks.** It's a normal `.dmg` — drag to Applications, no scripts,
  no admin password required for normal use.

---

## Reporting a vulnerability

Found a security issue? Let me know any way that's easiest — open a pull request
with a fix, file an issue, or use GitHub's
[private security advisory](https://github.com/whereissam/WiLens/security/advisories/new)
if you'd rather keep it private. I'll try to respond within a few days.

---

*This document describes the security posture of WiLens as of the current
release. Because the project is open source, you can always verify these claims
against the code itself.*
