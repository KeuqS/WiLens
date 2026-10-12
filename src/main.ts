import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./styles.css";
import { parseWifiQr, revealInvisible, type WifiPayload } from "./qr";

type ScannerState = "idle" | "scanning" | "joining" | "joined" | "error";

interface JoinWifiResponse {
  interface: string;
  message: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
const isWindows = navigator.userAgent.includes("Windows");

const systemNote = isWindows
  ? `WiLens saves a Wi-Fi profile for your Windows account and connects with
     it — no administrator prompt. On Windows 11, turning on Location access
     for desktop apps lets WiLens confirm the connection.`
  : `macOS requires Location access to scan for Wi-Fi networks, so it asks
     the first time — WiLens never tracks your location. If the quick join
     can't connect, it falls back to <code>networksetup</code>, which may
     show a macOS administrator prompt.`;

if (!app) {
  throw new Error("App root element was not found.");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <div class="hero-badge">
        <img src="/wilen-logo.png" alt="" class="hero-logo" />
        <p class="eyebrow">${isWindows ? "Windows" : "macOS"} Wi-Fi QR utility</p>
      </div>
      <h1>Point your camera at a Wi-Fi QR code.</h1>
      <p class="lede">
        WiLens scans the code, extracts the network details, and lets you join
        from a single desktop window.
      </p>
      <div class="hero-actions">
        <button id="start-scan" class="button button-primary">Start camera</button>
        <button id="rescan" class="button button-secondary" disabled>Scan again</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite">Camera is idle.</p>
    </section>

    <section class="scanner-panel">
      <div class="video-frame">
        <video id="scanner-video" class="video" muted playsinline></video>
        <div class="scan-overlay"></div>
      </div>

      <article id="result-card" class="result-card is-empty">
        <p class="result-label">Scanned network</p>
        <h2 id="ssid">No network scanned yet</h2>
        <dl class="details">
          <div>
            <dt>Security</dt>
            <dd id="security">-</dd>
          </div>
          <div>
            <dt>Password</dt>
            <dd id="password">-</dd>
          </div>
          <div>
            <dt>Hidden</dt>
            <dd id="hidden">-</dd>
          </div>
        </dl>
        <p class="system-note">${systemNote}</p>
        <div class="result-actions">
          <button id="join-network" class="button button-primary" disabled>Join network</button>
          <button id="copy-password" class="button button-secondary" disabled>Copy password</button>
        </div>
      </article>
    </section>
  </main>
`;

const video = queryElement<HTMLVideoElement>("#scanner-video");
const startButton = queryElement<HTMLButtonElement>("#start-scan");
const rescanButton = queryElement<HTMLButtonElement>("#rescan");
const joinButton = queryElement<HTMLButtonElement>("#join-network");
const copyButton = queryElement<HTMLButtonElement>("#copy-password");
const statusElement = queryElement<HTMLParagraphElement>("#status");
const resultCard = queryElement<HTMLElement>("#result-card");
const ssidElement = queryElement<HTMLElement>("#ssid");
const securityElement = queryElement<HTMLElement>("#security");
const passwordElement = queryElement<HTMLElement>("#password");
const hiddenElement = queryElement<HTMLElement>("#hidden");

const reader = new BrowserMultiFormatReader();
let controls: IScannerControls | null = null;
let currentPayload: WifiPayload | null = null;
let state: ScannerState = "idle";

startButton.addEventListener("click", () => {
  resetResult();
  void startScan();
});

rescanButton.addEventListener("click", () => {
  resetResult();
  void startScan();
});

joinButton.addEventListener("click", () => {
  void joinNetwork();
});

copyButton.addEventListener("click", () => {
  void copyPassword();
});

async function startScan(): Promise<void> {
  if (state === "scanning" || state === "joining") {
    return;
  }

  // Claim the state before awaiting so a double-click cannot start a second
  // scanner (which would leak the first one and leave the camera on).
  stopScan();
  state = "scanning";
  setStatus("Scanning for a Wi-Fi QR code...");
  toggleControls();

  try {
    const scanControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
      if (!result || state !== "scanning") {
        return;
      }

      try {
        const payload = parseWifiQr(result.getText());
        currentPayload = payload;
        state = "idle";
        stopScan();
        renderPayload(payload);
        setStatus(`Ready to join '${revealInvisible(payload.ssid)}'.`);
      } catch (parseError) {
        setStatus(getErrorMessage(parseError, "QR code detected, but it is not a valid Wi-Fi payload."));
      }
    });

    // A code may have been decoded, or the scan cancelled, while the camera
    // was still starting up.
    if (state === "scanning") {
      controls = scanControls;
    } else {
      scanControls.stop();
    }
  } catch (error) {
    setError(getCameraErrorMessage(error));
  }
}

function stopScan(): void {
  controls?.stop();
  controls = null;
}

async function joinNetwork(): Promise<void> {
  if (!currentPayload || state === "joining") {
    return;
  }

  state = "joining";
  setStatus(`Joining '${revealInvisible(currentPayload.ssid)}'...`);
  toggleControls();

  const onProgress = new Channel<string>();
  onProgress.onmessage = (message) => {
    if (state === "joining") {
      setStatus(message);
    }
  };

  try {
    const response = await invoke<JoinWifiResponse>("join_wifi", {
      request: {
        ssid: currentPayload.ssid,
        password: currentPayload.password,
        security: currentPayload.security,
        hidden: currentPayload.hidden,
      },
      onProgress,
    });

    state = "joined";
    setStatus(response.message);
  } catch (error) {
    setError(getErrorMessage(error, "Joining the network failed."));
    return;
  }

  toggleControls();
}

async function copyPassword(): Promise<void> {
  if (!currentPayload?.password) {
    return;
  }

  try {
    await navigator.clipboard.writeText(currentPayload.password);
    setStatus("Password copied to the clipboard.");
  } catch (error) {
    setStatus(getErrorMessage(error, "Unable to copy the password."));
  }
}

function resetResult(): void {
  stopScan();
  currentPayload = null;
  state = "idle";
  ssidElement.textContent = "No network scanned yet";
  securityElement.textContent = "-";
  passwordElement.textContent = "-";
  hiddenElement.textContent = "-";
  resultCard.classList.add("is-empty");
  setStatus("Camera is idle.");
  toggleControls();
}

function renderPayload(payload: WifiPayload): void {
  ssidElement.textContent = revealInvisible(payload.ssid);
  securityElement.textContent = payload.security;
  passwordElement.textContent = payload.password ? "Available" : "Open network";
  hiddenElement.textContent = payload.hidden ? "Yes" : "No";
  resultCard.classList.remove("is-empty");
  toggleControls();
}

function setStatus(message: string): void {
  statusElement.textContent = message;
}

function setError(message: string): void {
  state = "error";
  setStatus(message);
  toggleControls();
}

function toggleControls(): void {
  const busy = state === "scanning" || state === "joining";
  startButton.disabled = busy;
  rescanButton.disabled = busy;
  joinButton.disabled = !currentPayload || busy;
  copyButton.disabled = !currentPayload?.password || state === "joining";

  const joining = state === "joining";
  joinButton.classList.toggle("is-busy", joining);
  joinButton.setAttribute("aria-busy", String(joining));
  joinButton.textContent = joining ? "Joining..." : "Join network";
}

function getCameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Camera permission was denied.";
  }

  return getErrorMessage(error, "Unable to start the scanner.");
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error && "message" in error) {
    const value = Reflect.get(error, "message");
    if (typeof value === "string" && value) {
      return value;
    }
  }

  return fallback;
}

function queryElement<TElement extends Element>(selector: string): TElement {
  const element = document.querySelector<TElement>(selector);
  if (!element) {
    throw new Error(`Required element '${selector}' was not found.`);
  }

  return element;
}
