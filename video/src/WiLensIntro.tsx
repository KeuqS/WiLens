import { AbsoluteFill, Easing, Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { APP, AppWindow, SSID } from "./AppWindow";
import { FPS, lerp, prog, s, visible } from "./anim";

const FONT = '"SF Pro Display", "Segoe UI", sans-serif';
const MONO = '"SF Mono", Menlo, monospace';
const MIST = "#ecf3ef";
const MIST_DIM = "rgba(236,243,239,.68)";
const GOLD = "#f1d77a";

const HOOK_END = 3.6;
const TURN_END = 6.2;
const APP_END = 20.2;
export const INTRO_FRAMES = s(25.5);

const background =
  "radial-gradient(circle at 10% 0%, rgba(62,111,88,.42), transparent 38%)," +
  "radial-gradient(circle at 100% 55%, rgba(224,153,78,.18), transparent 32%)," +
  "linear-gradient(135deg, #10211d 0%, #162e26 48%, #0b1613 100%)";

/** Scene 1: the pain of typing a guest Wi-Fi password. */
const Hook: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const pw = "xK7#mq-Guest_2.4G!vB9";
  const typed = pw.slice(0, Math.round(prog(t, 0.5, 2.3, Easing.linear) * pw.length));
  const wrong = t > 2.5;
  const shake = wrong && t < 3.0 ? Math.sin((t - 2.5) * 60) * 14 * (1 - prog(t, 2.5, 3.0, Easing.linear)) : 0;
  const caret = (t > 0.5 && t < 2.3) || Math.floor(t * 2.4) % 2 === 0;
  return (
    <AbsoluteFill style={{ opacity: 1 - prog(t, HOOK_END - 0.4, HOOK_END, Easing.linear), fontFamily: FONT, color: MIST }}>
      <div style={{ position: "absolute", top: 250, width: "100%", textAlign: "center", fontSize: 64, fontWeight: 700, letterSpacing: "-0.03em" }}>
        Joining Wi-Fi usually means typing this.
      </div>
      <div
        style={{
          position: "absolute",
          left: 460,
          top: 410,
          width: 1000,
          padding: "30px 40px",
          borderRadius: 28,
          background: "rgba(6,13,11,.55)",
          border: `2px solid ${wrong ? "rgba(240,138,122,.75)" : "rgba(255,255,255,.1)"}`,
          transform: `translateX(${shake}px)`,
        }}
      >
        <div style={{ fontSize: 22, color: MIST_DIM }}>Password for “{SSID}”</div>
        <div style={{ fontFamily: MONO, fontSize: 56, marginTop: 18, whiteSpace: "nowrap" }}>
          {typed}
          <span style={{ display: "inline-block", width: 4, height: 56, background: GOLD, verticalAlign: -8, marginLeft: 4, opacity: caret ? 1 : 0 }} />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 650,
          width: "100%",
          textAlign: "center",
          fontSize: 30,
          fontWeight: 500,
          color: "#f08a7a",
          opacity: prog(t, 2.6, 2.9),
          transform: `translateY(${(1 - prog(t, 2.6, 2.9)) * 12}px)`,
        }}
      >
        Incorrect password. One wrong character and you start over.
      </div>
    </AbsoluteFill>
  );
};

/** Scene 2: the turn. */
const Turn: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const words = ["Or", "just", "point", "your", "camera."];
  return (
    <AbsoluteFill
      style={{
        opacity: visible(t, 0, TURN_END - HOOK_END, 0.3, 0.4),
        fontFamily: FONT,
        color: MIST,
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
      }}
    >
      <Img src={staticFile("wilen-logo.png")} style={{ width: 220, height: 220, transform: `scale(${lerp(0.6, 1, prog(t, 0, 0.7))})` }} />
      <div style={{ fontSize: 104, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1 }}>
        {words.map((w, i) => {
          const k = prog(t, 0.3 + i * 0.13, 0.8 + i * 0.13);
          return (
            <span key={w} style={{ display: "inline-block", margin: "0 0.12em", opacity: k, transform: `translateY(${(1 - k) * 50}px)` }}>
              {w}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

/** Camera framing of the app window: a focus point (window px) and a zoom. */
const SHOTS = {
  wide: { x: 600, y: 434, z: 1.0 },
  scanner: { x: 897, y: 262, z: 2.1 },
  network: { x: 897, y: 617, z: 1.6 },
};
const CAMERA: [number, keyof typeof SHOTS][] = [
  [0, "wide"],
  [1.6, "wide"],
  [2.5, "scanner"],
  [5.4, "scanner"],
  [6.3, "network"],
  [7.9, "network"],
  [8.9, "wide"],
];

const camera = (t: number) => {
  const times = CAMERA.map(([time]) => time);
  const pick = (k: "x" | "y" | "z") =>
    interpolate(t, times, CAMERA.map(([, shot]) => SHOTS[shot][k]), {
      easing: Easing.inOut(Easing.cubic),
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return { x: pick("x"), y: pick("y"), z: pick("z") };
};

const MenuBar: React.FC<{ t: number }> = ({ t }) => {
  const joining = t >= APP.clickJoin && t < APP.joined;
  const joined = t >= APP.joined;
  const arc = (i: number) => (joined ? 1 : joining ? ((Math.floor(t * 5) % 3) >= i ? 1 : 0.3) : 0.3);
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 36,
        padding: "0 26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "rgba(6,13,11,.6)",
        fontFamily: FONT,
        fontSize: 16,
        color: MIST,
      }}
    >
      <div style={{ display: "flex", gap: 26, alignItems: "center" }}>
        <svg width="15" height="18" viewBox="0 0 16 19">
          <path
            fill={MIST}
            d="M13.3 10.1c0-2.4 2-3.5 2-3.6-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9s-1.9-.9-3.1-.8C3.7 4.8 2.3 5.7 1.5 7c-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.4-1-2.4-3.6zM11 3.1c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.7 1.4-.6.7-1.1 1.8-1 2.9 1 .1 2.1-.5 2.7-1.3z"
          />
        </svg>
        <b>WiLens</b>
        <span style={{ color: MIST_DIM }}>File</span>
        <span style={{ color: MIST_DIM }}>Edit</span>
        <span style={{ color: MIST_DIM }}>Window</span>
      </div>
      <div style={{ display: "flex", gap: 20, alignItems: "center", color: MIST_DIM }}>
        <svg width="24" height="18" viewBox="0 0 26 20">
          <path d="M1.5 7.2a16.5 16.5 0 0 1 23 0" stroke={MIST} strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={arc(2)} />
          <path d="M5.6 11.1a10.6 10.6 0 0 1 14.8 0" stroke={MIST} strokeWidth={2.6} fill="none" strokeLinecap="round" opacity={arc(1)} />
          <circle cx="13" cy="16.2" r="2.4" fill={MIST} opacity={arc(0)} />
        </svg>
        <span>Mon 9:41 AM</span>
      </div>
    </div>
  );
};

const CAPTIONS: [number, number, string, string, string][] = [
  [0.8, 5.2, "1", "Scan the code", "Point your Mac’s camera at any Wi-Fi QR code."],
  [5.3, 7.6, "2", "Check before you join", "See the network, its security, and whether it’s hidden."],
  [7.7, 13.6, "3", "Join in one click", "No typing passwords."],
];

/** Scene 3: the real app, walked through scan → check → join. */
const Demo: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const dur = APP_END - TURN_END;
  const enter = prog(t, 0, 0.7);
  const exit = prog(t, dur - 0.6, dur, Easing.in(Easing.cubic));
  const cam = camera(t);
  const z = cam.z * lerp(0.94, 1, enter) * (1 - exit * 0.05);
  const cx = 960;
  const cy = 480;
  return (
    <AbsoluteFill style={{ opacity: Math.min(enter, 1 - exit) }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          transformOrigin: "0 0",
          transform: `translate(${cx - z * cam.x}px, ${cy - z * cam.y + (1 - enter) * 40}px) scale(${z})`,
        }}
      >
        <AppWindow t={t} />
      </div>
      <MenuBar t={t} />
      {CAPTIONS.map(([from, to, n, title, sub]) => {
        const o = visible(t, from, to, 0.35, 0.3);
        return (
          <div
            key={n}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 44,
              display: "flex",
              justifyContent: "center",
              opacity: o,
              transform: `translateY(${(1 - prog(t, from, from + 0.5)) * 20}px)`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 20,
                padding: "16px 30px",
                borderRadius: 999,
                background: "rgba(6,13,11,.78)",
                border: "1px solid rgba(255,255,255,.08)",
                fontFamily: FONT,
                color: MIST,
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 24, color: GOLD }}>{n}</span>
              <span style={{ fontSize: 38, fontWeight: 700, letterSpacing: "-0.02em" }}>{title}</span>
              <span style={{ fontSize: 24, color: MIST_DIM }}>{sub}</span>
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** Scene 4: name, promise, where to get it. */
const Outro: React.FC = () => {
  const t = useCurrentFrame() / FPS;
  const rise = (from: number) => {
    const k = prog(t, from, from + 0.6);
    return { opacity: k, transform: `translateY(${(1 - k) * 24}px)` };
  };
  return (
    <AbsoluteFill style={{ fontFamily: FONT, color: MIST, alignItems: "center", justifyContent: "center", textAlign: "center" }}>
      <Img
        src={staticFile("wilen-logo.png")}
        style={{ width: 210, height: 210, opacity: prog(t, 0, 0.5), transform: `scale(${lerp(0.7, 1, prog(t, 0, 0.8))})` }}
      />
      <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1, ...rise(0.2) }}>WiLens</div>
      <div style={{ fontSize: 46, fontWeight: 500, color: MIST_DIM, marginTop: 18, ...rise(0.6) }}>
        Scan a Wi-Fi QR code. You’re online.
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 44, ...rise(1.1) }}>
        {["macOS · Apple Silicon", "Windows (experimental)", "Free & open source"].map((chip) => (
          <span key={chip} style={{ fontSize: 22, padding: "10px 22px", borderRadius: 999, border: "1px solid rgba(241,215,122,.45)", color: GOLD }}>
            {chip}
          </span>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: 26, color: MIST_DIM, marginTop: 34, ...rise(1.5) }}>github.com/whereissam/WiLens</div>
    </AbsoluteFill>
  );
};

export const WiLensIntro: React.FC = () => (
  <AbsoluteFill style={{ background }}>
    <Sequence durationInFrames={s(HOOK_END)}>
      <Hook />
    </Sequence>
    <Sequence from={s(HOOK_END)} durationInFrames={s(TURN_END - HOOK_END)}>
      <Turn />
    </Sequence>
    <Sequence from={s(TURN_END)} durationInFrames={s(APP_END - TURN_END)}>
      <Demo />
    </Sequence>
    <Sequence from={s(APP_END)}>
      <Outro />
    </Sequence>
  </AbsoluteFill>
);
