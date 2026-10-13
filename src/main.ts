import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { Channel, invoke } from "@tauri-apps/api/core";
import "./styles.css";
import {
  buildWifiQr,
  parseWifiQr,
  revealInvisible,
  type WifiPayload,
  type WifiSecurity,
} from "./qr";
import { canvasToPng, drawWifiQr } from "./share";

type ScannerState = "idle" | "scanning" | "joining" | "joined" | "error";
type Mode = "join" | "share" | "check";
type CheckStatus = "pass" | "warn" | "fail" | "skipped";

interface CheckStep {
  id: string;
  status: CheckStatus;
  detail: string;
}

interface CheckReport {
  steps: CheckStep[];
  verdict: string;
  summary: string;
}

const CHECK_STEPS: { id: string; label: string }[] = [
  { id: "link", label: "Network connection" },
  { id: "router", label: "Router" },
  { id: "dns", label: "Website names (DNS)" },
  { id: "internet", label: "Internet" },
];

const HERO_TEXT: Record<Mode, { title: string; lede: string }> = {
  join: {
    title: "Point your camera at a Wi-Fi QR code.",
    lede: "WiLens scans the code, extracts the network details, and lets you join from a single desktop window.",
  },
  check: {
    title: "Find out why the internet isn't working.",
    lede: "WiLens checks your connection one step at a time and tells you what's wrong in plain language.",
  },
  share: {
    title: "Share your Wi-Fi with a QR code.",
    lede: "Type your network's details and WiLens makes a code guests can scan with their phone camera. Nothing is saved or sent anywhere.",
  },
};

interface JoinWifiResponse {
  interface: string;
  message: string;
}

const app = document.querySelector<HTMLDivElement>("#app");
const isWindows = navigator.userAgent.includes("Windows");
const CHECK_HOST = isWindows ? "www.msftconnecttest.com" : "captive.apple.com";

const systemNote = isWindows
  ? `WiLens saves a Wi-Fi profile for your Windows account and connects with
     it — no administrator prompt. On Windows 11, turning on Location access
     for desktop apps lets WiLens confirm the connection.`
  : `macOS requires Location access to scan for Wi-Fi networks, so it asks
     the first time — WiLens never tracks your location. It uses the scan to
     check the network matches the QR code. Without Location access WiLens can
     still join open networks; for secured ones, copy the password and join
     from the Wi-Fi menu.`;

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
      <div class="mode-switch" role="tablist" aria-label="What do you want to do?">
        <button id="mode-join" class="mode-tab" role="tab" aria-selected="true" aria-controls="scanner-panel">Join a network</button>
        <button id="mode-share" class="mode-tab" role="tab" aria-selected="false" aria-controls="share-panel">Share a network</button>
        <button id="mode-check" class="mode-tab" role="tab" aria-selected="false" aria-controls="check-panel">Check connection</button>
      </div>
      <h1 id="hero-title">${HERO_TEXT.join.title}</h1>
      <p id="hero-lede" class="lede">${HERO_TEXT.join.lede}</p>
      <div id="join-actions" class="hero-actions">
        <button id="start-scan" class="button button-primary">Start camera</button>
        <button id="rescan" class="button button-secondary" disabled>Scan again</button>
      </div>
      <p id="status" class="status" role="status" aria-live="polite">Camera is idle.</p>
    </section>

    <section id="scanner-panel" class="scanner-panel" role="tabpanel">
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

    <section id="share-panel" class="share-panel" role="tabpanel" hidden>
      <form id="share-form" class="share-form" autocomplete="off">
        <label class="field">
          <span>Network name</span>
          <input id="share-ssid" type="text" spellcheck="false" autocapitalize="off" />
        </label>
        <label class="field">
          <span>Security</span>
          <select id="share-security">
            <option value="WPA">WPA / WPA2 / WPA3</option>
            <option value="WEP">WEP</option>
            <option value="nopass">None (open network)</option>
          </select>
        </label>
        <label id="share-password-field" class="field">
          <span>Password</span>
          <span class="password-row">
            <input id="share-password" type="password" spellcheck="false" autocapitalize="off" />
            <button id="share-reveal" type="button" class="button button-secondary">Show</button>
          </span>
        </label>
        <label class="checkbox">
          <input id="share-hidden" type="checkbox" />
          <span>Hidden network</span>
        </label>
      </form>

      <article id="qr-card" class="qr-card is-empty">
        <canvas id="share-canvas" class="qr-canvas" role="img" aria-label="Wi-Fi QR code"></canvas>
        <p id="share-hint" class="qr-hint">Enter your network's name and password to make a code.</p>
        <p class="system-note">Anyone who sees or photographs this code can join the network. Only share it with people you trust.</p>
        <div class="result-actions">
          <button id="share-save" class="button button-primary" disabled>Save image…</button>
        </div>
      </article>
    </section>

    <section id="check-panel" class="check-panel" role="tabpanel" hidden>
      <article class="check-card">
        <p class="result-label">Connection check</p>
        <h2 id="check-summary" class="check-summary">Run a check to see where the connection stops working.</h2>
        <ol id="check-steps" class="check-steps">
          ${CHECK_STEPS.map(
            ({ id, label }) => `
          <li data-step="${id}" data-status="idle">
            <span class="check-label">${label}</span>
            <span class="check-detail">Not checked yet</span>
          </li>`,
          ).join("")}
        </ol>
        <div class="result-actions">
          <button id="check-run" class="button button-primary">Run check</button>
          <button id="check-copy" class="button button-secondary" disabled>Copy report</button>
        </div>
        <p class="system-note">The check pings your router and asks ${CHECK_HOST} for a small page, the same address ${isWindows ? "Windows" : "macOS"} uses to detect sign-in pages. It only runs when you click Run check, and the report contains no passwords or network names.</p>
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
const modeJoinTab = queryElement<HTMLButtonElement>("#mode-join");
const modeShareTab = queryElement<HTMLButtonElement>("#mode-share");
const modeCheckTab = queryElement<HTMLButtonElement>("#mode-check");
const checkPanel = queryElement<HTMLElement>("#check-panel");
const checkSummary = queryElement<HTMLElement>("#check-summary");
const checkRun = queryElement<HTMLButtonElement>("#check-run");
const checkCopy = queryElement<HTMLButtonElement>("#check-copy");
const heroTitle = queryElement<HTMLElement>("#hero-title");
const heroLede = queryElement<HTMLElement>("#hero-lede");
const joinActions = queryElement<HTMLElement>("#join-actions");
const scannerPanel = queryElement<HTMLElement>("#scanner-panel");
const sharePanel = queryElement<HTMLElement>("#share-panel");
const shareForm = queryElement<HTMLFormElement>("#share-form");
const shareSsid = queryElement<HTMLInputElement>("#share-ssid");
const shareSecurity = queryElement<HTMLSelectElement>("#share-security");
const sharePasswordField = queryElement<HTMLElement>("#share-password-field");
const sharePassword = queryElement<HTMLInputElement>("#share-password");
const shareReveal = queryElement<HTMLButtonElement>("#share-reveal");
const shareHidden = queryElement<HTMLInputElement>("#share-hidden");
const qrCard = queryElement<HTMLElement>("#qr-card");
const shareCanvas = queryElement<HTMLCanvasElement>("#share-canvas");
const shareHint = queryElement<HTMLElement>("#share-hint");
const shareSave = queryElement<HTMLButtonElement>("#share-save");

const reader = new BrowserMultiFormatReader();
let controls: IScannerControls | null = null;
let currentPayload: WifiPayload | null = null;
let state: ScannerState = "idle";
let mode: Mode = "join";
let saving = false;
let checking = false;
let lastReport: CheckReport | null = null;

modeJoinTab.addEventListener("click", () => setMode("join"));
modeShareTab.addEventListener("click", () => setMode("share"));
modeCheckTab.addEventListener("click", () => setMode("check"));
checkRun.addEventListener("click", () => {
  void runCheck();
});
checkCopy.addEventListener("click", () => {
  void copyCheckReport();
});
shareForm.addEventListener("input", updateSharePreview);
shareForm.addEventListener("submit", (event) => event.preventDefault());
shareReveal.addEventListener("click", () => {
  const reveal = sharePassword.type === "password";
  sharePassword.type = reveal ? "text" : "password";
  shareReveal.textContent = reveal ? "Hide" : "Show";
});
shareSave.addEventListener("click", () => {
  void saveShareImage();
});

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

function setMode(next: Mode): void {
  if (next === mode || state === "joining") {
    return;
  }
  mode = next;

  // Leaving the scanner turns the camera off.
  if (next !== "join" && state === "scanning") {
    stopScan();
    state = "idle";
    toggleControls();
  }

  modeJoinTab.setAttribute("aria-selected", String(next === "join"));
  modeShareTab.setAttribute("aria-selected", String(next === "share"));
  modeCheckTab.setAttribute("aria-selected", String(next === "check"));
  scannerPanel.hidden = next !== "join";
  joinActions.hidden = next !== "join";
  sharePanel.hidden = next !== "share";
  checkPanel.hidden = next !== "check";
  heroTitle.textContent = HERO_TEXT[next].title;
  heroLede.textContent = HERO_TEXT[next].lede;
  setStatus(
    {
      join: "Camera is idle.",
      share: "Nothing leaves this computer until you save the image.",
      check: "Nothing is checked until you click Run check.",
    }[next],
  );
  if (next === "share") {
    shareSsid.focus();
  }
}

async function runCheck(): Promise<void> {
  if (checking) {
    return;
  }
  checking = true;
  lastReport = null;
  checkRun.disabled = true;
  checkRun.classList.add("is-busy");
  checkRun.textContent = "Checking...";
  checkCopy.disabled = true;
  checkSummary.textContent = "Checking your connection...";
  CHECK_STEPS.forEach(({ id }, index) =>
    renderCheckStep({ id, status: "skipped", detail: index === 0 ? "Checking..." : "Waiting" }, index === 0 ? "running" : "idle"),
  );

  const onStep = new Channel<CheckStep>();
  onStep.onmessage = (step) => {
    renderCheckStep(step);
    const next = CHECK_STEPS.findIndex(({ id }) => id === step.id) + 1;
    if (next > 0 && next < CHECK_STEPS.length) {
      renderCheckStep({ id: CHECK_STEPS[next].id, status: "skipped", detail: "Checking..." }, "running");
    }
  };

  try {
    const report = await invoke<CheckReport>("check_connection", { onStep });
    report.steps.forEach((step) => renderCheckStep(step));
    lastReport = report;
    checkSummary.textContent = report.summary;
    checkCopy.disabled = false;
  } catch (error) {
    checkSummary.textContent = getErrorMessage(error, "The connection check could not run.");
  } finally {
    checking = false;
    checkRun.disabled = false;
    checkRun.classList.remove("is-busy");
    checkRun.textContent = "Run again";
  }
}

/** Show one step's result; `override` marks a step as running or not started. */
function renderCheckStep(step: CheckStep, override?: "running" | "idle"): void {
  const item = checkPanel.querySelector<HTMLElement>(`[data-step="${step.id}"]`);
  if (!item) {
    return;
  }
  item.dataset.status = override ?? step.status;
  const detail = item.querySelector<HTMLElement>(".check-detail");
  if (detail) {
    detail.textContent = step.detail;
  }
}

async function copyCheckReport(): Promise<void> {
  if (!lastReport) {
    return;
  }
  const lines = [
    "WiLens connection check",
    `Result: ${lastReport.summary}`,
    ...lastReport.steps.map((step) => {
      const label = CHECK_STEPS.find(({ id }) => id === step.id)?.label ?? step.id;
      return `- ${label}: ${step.status.toUpperCase()} - ${step.detail}`;
    }),
    `System: ${isWindows ? "Windows" : "macOS"}`,
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    setStatus("Copied the report. It contains no passwords or network names.");
  } catch (error) {
    setStatus(getErrorMessage(error, "Unable to copy the report."));
  }
}

function updateSharePreview(): void {
  const security = shareSecurity.value as WifiSecurity;
  sharePasswordField.hidden = security === "nopass";

  try {
    const payload = buildWifiQr({
      ssid: shareSsid.value,
      password: sharePassword.value,
      security,
      hidden: shareHidden.checked,
    });
    drawWifiQr(shareCanvas, payload, shareSsid.value);
    qrCard.classList.remove("is-empty");
    shareHint.textContent = `Guests can scan this to join '${revealInvisible(shareSsid.value)}'.`;
    shareSave.disabled = saving;
  } catch (error) {
    shareCanvas.width = 0;
    shareCanvas.height = 0;
    qrCard.classList.add("is-empty");
    shareHint.textContent = shareSsid.value
      ? getErrorMessage(error, "These details can't make a QR code.")
      : "Enter your network's name and password to make a code.";
    shareSave.disabled = true;
  }
}

async function saveShareImage(): Promise<void> {
  if (saving || qrCard.classList.contains("is-empty")) {
    return;
  }
  saving = true;
  shareSave.disabled = true;

  try {
    const png = await canvasToPng(shareCanvas);
    const saved = await invoke<boolean>("save_qr_image", {
      png: Array.from(png),
      suggestedName: shareSsid.value,
    });
    if (saved) {
      setStatus("Saved the QR code image.");
    }
  } catch (error) {
    setStatus(getErrorMessage(error, "Could not save the QR code image."));
  } finally {
    saving = false;
    shareSave.disabled = qrCard.classList.contains("is-empty");
  }
}

function toggleControls(): void {
  const busy = state === "scanning" || state === "joining";
  modeShareTab.disabled = state === "joining";
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
