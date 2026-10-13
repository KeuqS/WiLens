# WiLens Usage

## Open the App

If you already built the app locally, open it with:

```bash
open src-tauri/target/release/bundle/macos/WiLens.app
```

If macOS blocks first launch:

1. Open Finder.
2. Go to `src-tauri/target/release/bundle/macos/`.
3. Right-click `WiLens.app`.
4. Choose `Open`.

## What WiLens Does

WiLens scans a Wi-Fi QR code and helps your Mac join that network.

Supported QR format:

```txt
WIFI:T:WPA;S:MyWifi;P:mypassword;;
```

## How To Use It

1. Open WiLens.
2. Click `Start camera`.
3. Allow camera access if macOS asks.
4. Point the camera at a Wi-Fi QR code.
5. Wait for WiLens to detect the network.
6. Review the scanned network details.
7. Click `Join network`.
8. Approve any macOS prompt if shown.

## Share a Network

Switch to **Share a network**, type the network name, security type, and
password, and WiLens draws a standard Wi-Fi QR code as you type. **Save image…**
asks where to save a PNG (the network name is printed under the code; the
password is not). Anyone who sees the code can join the network, so share it
only with people you trust. WiLens does not keep the details after you close it.

## Check a Connection

Switch to **Check connection** and click **Run check**. WiLens tests four things
in order and explains where the connection stops working:

1. **Network connection:** is this computer on a network at all?
2. **Router:** does the router answer? (Some routers ignore this check, so a
   silent router only counts against the connection if later steps fail too.)
3. **Website names (DNS):** can names like `captive.apple.com` be looked up?
4. **Internet:** does the internet answer, or does a sign-in page answer
   instead (common in hotels, airports, and cafés)?

**Copy report** copies the result as text to paste into a support request. It
contains no passwords or network names. The check only contacts your router and
`captive.apple.com` (Windows: `www.msftconnecttest.com`), and only when you
click the button.

## Expected macOS Prompts

WiLens may trigger system prompts for:

- **Camera** — to scan the QR code.
- **Location** — macOS requires Location access before *any* app can scan for
  Wi-Fi networks. WiLens only uses it to find and join your network; it never
  collects, stores, or shares your location. Granting it lets WiLens join
  quietly via CoreWLAN, with no administrator prompt.
- **Administrator approval** — only as a fallback for open networks. If the
  quiet CoreWLAN join can't run (e.g. Location was denied), WiLens joins open
  networks with the `networksetup` tool, which may ask for an administrator
  name and password. Secured networks need Location access so WiLens can check
  the network's security; otherwise use Copy password below.

## Copy Password Fallback

If joining does not work as expected, use `Copy password` and connect manually from macOS Wi-Fi settings.

## Troubleshooting

### Camera does not start

- Check macOS camera permissions for the app.
- Restart the app and try again.

### QR code is not detected

- Move closer to the QR code.
- Improve lighting.
- Make sure the QR code contains a Wi-Fi payload.

### Network join fails

- Verify the QR code uses the correct SSID and password.
- Check whether macOS showed an approval dialog behind the app.
- Try manual connection using the copied password.

### App says success but macOS showed a prompt

That can happen. The Wi-Fi join result and the macOS authorization dialog are controlled by the system, not fully by the app UI.
