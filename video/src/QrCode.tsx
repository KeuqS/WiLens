import QRCode from "qrcode";

/** A real, scannable QR code rendered as one SVG path. */
export const QrCode: React.FC<{ text: string; size: number }> = ({ text, size }) => {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = modules.size;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (modules.get(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${n + 4} ${n + 4}`} shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={n + 4} height={n + 4} fill="#fff" />
      <path d={d} fill="#14201c" />
    </svg>
  );
};
