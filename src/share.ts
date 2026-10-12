import { BarcodeFormat, EncodeHintType, QRCodeWriter, type BitMatrix } from "@zxing/library";
import { revealInvisible } from "./qr";

/** Pixels per QR module in the exported image; large enough to print. */
const MODULE_PX = 12;
const CAPTION_PX = 64;

/**
 * Encode a payload as a QR matrix with the standard 4-module quiet zone.
 * Medium error correction survives a printed code being scuffed or folded;
 * UTF-8 keeps non-ASCII network names intact.
 */
export function encodeQr(payload: string): BitMatrix {
  const hints = new Map<EncodeHintType, unknown>([
    [EncodeHintType.CHARACTER_SET, "UTF-8"],
    [EncodeHintType.ERROR_CORRECTION, "M"],
  ]);
  return new QRCodeWriter().encode(payload, BarcodeFormat.QR_CODE, 0, 0, hints);
}

/**
 * Draw a Wi-Fi QR code onto `canvas`, with the network name printed under it
 * so a printed card says which network it is for. The password is never
 * drawn as text.
 */
export function drawWifiQr(canvas: HTMLCanvasElement, payload: string, ssid: string): void {
  const matrix = encodeQr(payload);
  const size = matrix.getWidth() * MODULE_PX;
  canvas.width = size;
  canvas.height = size + CAPTION_PX;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("This window cannot draw images.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#000000";
  for (let y = 0; y < matrix.getHeight(); y += 1) {
    for (let x = 0; x < matrix.getWidth(); x += 1) {
      if (matrix.get(x, y)) {
        context.fillRect(x * MODULE_PX, y * MODULE_PX, MODULE_PX, MODULE_PX);
      }
    }
  }

  context.fillStyle = "#10211d";
  context.font = '600 26px "SF Pro Display", "Segoe UI", sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(
    `Wi-Fi: ${revealInvisible(ssid)}`,
    canvas.width / 2,
    size + CAPTION_PX / 2 - 8,
    canvas.width - 2 * MODULE_PX,
  );
}

/** The canvas contents as PNG bytes. */
export function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create the image."));
        return;
      }
      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, "image/png");
  });
}
