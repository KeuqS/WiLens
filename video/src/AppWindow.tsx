import { Img, staticFile } from "remotion";
import "../../src/styles.css";
import "./video.css";
import { prog } from "./anim";
import { QrCode } from "./QrCode";

export const SSID = "Studio Guest";
const PAYLOAD = `WIFI:T:WPA;S:${SSID};P:welcome-to-the-studio;;`;

/** Moments in the app's story, in seconds from when the window appears. */
export const APP = {
  clickStart: 1.4,
  decoded: 5.0,
  clickJoin: 7.6,
  connecting: 8.4,
  joined: 10.4,
};

const Cursor: React.FC<{ t: number; arrive: number; click: number }> = ({ t, arrive, click }) => {
  const move = prog(t, arrive - 0.9, arrive);
  const opacity = Math.min(prog(t, arrive - 1.0, arrive - 0.8), 1 - prog(t, click + 0.4, click + 0.7));
  const pressed = t > click && t < click + 0.15 ? 0.85 : 1;
  return (
    <svg
      viewBox="0 0 24 24"
      width={30}
      height={30}
      style={{
        position: "absolute",
        left: "55%",
        top: "45%",
        opacity,
        zIndex: 5,
        transform: `translate(${(1 - move) * 260}px, ${(1 - move) * 170}px) scale(${pressed})`,
        transformOrigin: "4px 2px",
        pointerEvents: "none",
      }}
    >
      <path
        d="M5 2.5v17.2l4.6-4.4 3 6.7 3-1.3-3-6.6h6.3z"
        fill="#fff"
        stroke="#000"
        strokeWidth={1.4}
        strokeLinejoin="round"
      />
    </svg>
  );
};

/** Simulated camera feed: a warm room, with a Wi-Fi card held up to the lens. */
const CameraFeed: React.FC<{ t: number }> = ({ t }) => {
  const on = prog(t, APP.clickStart + 0.2, APP.clickStart + 0.8) * (1 - prog(t, APP.decoded + 0.3, APP.decoded + 0.9));
  const enter = prog(t, 2.3, 3.4);
  const wobbleX = Math.sin(t * 1.7) * 4 + Math.sin(t * 3.1) * 1.5;
  const wobbleY = Math.cos(t * 1.3) * 3;
  const rot = -4 + Math.sin(t * 1.1) * 1.4;
  const flash = Math.sin(prog(t, APP.decoded, APP.decoded + 0.35) * Math.PI) * 0.35;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: on }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(circle at 18% 22%, rgba(255,214,150,.55), transparent 22%)," +
            "radial-gradient(circle at 82% 30%, rgba(170,200,190,.25), transparent 26%)," +
            "radial-gradient(ellipse at 50% 120%, #6b5440 0%, transparent 55%)," +
            "linear-gradient(180deg, #2b2f2b 0%, #3a3631 60%, #4a3d30 100%)",
          filter: "blur(6px)",
          transform: "scale(1.1)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: 158,
          padding: "12px 14px 10px",
          borderRadius: 14,
          background: "#f7f5ef",
          boxShadow: "0 18px 40px rgba(0,0,0,.45)",
          textAlign: "center",
          color: "#1b2420",
          transform: `translate(-50%, -50%) translate(${wobbleX}px, ${wobbleY + (1 - enter) * 300}px) rotate(${rot}deg)`,
        }}
      >
        <QrCode text={PAYLOAD} size={130} />
        <div style={{ fontWeight: 700, fontSize: 13, marginTop: 4 }}>{SSID}</div>
        <div style={{ fontSize: 10, color: "#5f6a64" }}>Scan to join our Wi-Fi</div>
      </div>
      <div style={{ position: "absolute", inset: 0, background: "#fff", opacity: flash }} />
    </div>
  );
};

export const AppWindow: React.FC<{ t: number }> = ({ t }) => {
  const scanning = t >= APP.clickStart && t < APP.decoded;
  const decoded = t >= APP.decoded;
  const joining = t >= APP.clickJoin && t < APP.joined;
  const busy = scanning || joining;

  const status = (() => {
    if (t >= APP.joined) return `Joined '${SSID}' successfully.`;
    if (t >= APP.connecting) return `Connecting to '${SSID}'...`;
    if (t >= APP.clickJoin) return `Joining '${SSID}'...`;
    if (decoded) return `Ready to join '${SSID}'.`;
    if (scanning) return "Scanning for a Wi-Fi QR code...";
    return "Camera is idle.";
  })();

  // Matches the app's 2.3s ease-in-out sweep of ±140px.
  const sweep = -Math.cos(((t % 2.3) / 2.3) * Math.PI * 2) * 140;

  return (
    <div
      style={{
        width: 1200,
        borderRadius: 12,
        overflow: "hidden",
        border: "1px solid rgba(255,255,255,.12)",
        boxShadow: "0 50px 140px rgba(0,0,0,.55)",
      }}
    >
      <div
        style={{
          height: 28,
          background: "#1d2724",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 12px",
          borderBottom: "1px solid rgba(0,0,0,.4)",
          position: "relative",
        }}
      >
        {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
          <i key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c, display: "block" }} />
        ))}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            textAlign: "center",
            fontSize: 13,
            fontWeight: 600,
            color: "rgba(236,243,239,.6)",
          }}
        >
          WiLens
        </span>
      </div>

      <div
        className="wl-app"
        style={{
          color: "#ecf3ef",
          fontFamily: '"SF Pro Display", "Segoe UI", sans-serif',
          lineHeight: 1.5,
          background:
            "radial-gradient(circle at top left, rgba(62, 111, 88, 0.38), transparent 32%)," +
            "radial-gradient(circle at right, rgba(224, 153, 78, 0.2), transparent 28%)," +
            "linear-gradient(135deg, #10211d 0%, #162e26 48%, #0b1613 100%)",
          ["--sweep" as string]: `${sweep}px`,
          ["--spin" as string]: `${(t * 360) / 0.7}deg`,
        }}
      >
        <main className="shell">
          <section className="hero">
            <div className="hero-badge">
              <Img src={staticFile("wilen-logo.png")} alt="" className="hero-logo" />
              <p className="eyebrow">macOS Wi-Fi QR utility</p>
            </div>
            <h1>Point your camera at a Wi-Fi QR code.</h1>
            <p className="lede">
              WiLens scans the code, extracts the network details, and lets you join from a single desktop window.
            </p>
            <div className="hero-actions">
              <button className="button button-primary" disabled={busy}>
                Start camera
                <Cursor t={t} arrive={APP.clickStart - 0.1} click={APP.clickStart} />
              </button>
              <button className="button button-secondary" disabled={busy || !decoded}>
                Scan again
              </button>
            </div>
            <p className="status" role="status">
              {status}
            </p>
          </section>

          <section className="scanner-panel">
            <div className="video-frame">
              <CameraFeed t={t} />
              {scanning && <div className="scan-overlay" />}
            </div>

            <article className={`result-card${decoded ? "" : " is-empty"}`}>
              <p className="result-label">Scanned network</p>
              <h2>{decoded ? SSID : "No network scanned yet"}</h2>
              <dl className="details">
                <div>
                  <dt>Security</dt>
                  <dd>{decoded ? "WPA" : "-"}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd>{decoded ? "Available" : "-"}</dd>
                </div>
                <div>
                  <dt>Hidden</dt>
                  <dd>{decoded ? "No" : "-"}</dd>
                </div>
              </dl>
              <p className="system-note">
                macOS requires Location access to scan for Wi-Fi networks, so it asks the first time — WiLens never
                tracks your location. If the quick join can't connect, it falls back to <code>networksetup</code>,
                which may show a macOS administrator prompt.
              </p>
              <div className="result-actions">
                <button
                  className={`button button-primary${joining ? " is-busy" : ""}`}
                  disabled={!decoded || busy}
                  aria-busy={joining}
                >
                  {joining ? "Joining..." : "Join network"}
                  <Cursor t={t} arrive={APP.clickJoin - 0.1} click={APP.clickJoin} />
                </button>
                <button className="button button-secondary" disabled={!decoded || joining}>
                  Copy password
                </button>
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>
  );
};
