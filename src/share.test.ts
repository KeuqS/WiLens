import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library";
import { describe, expect, it } from "vitest";
import { buildWifiQr, parseWifiQr } from "./qr";
import { encodeQr } from "./share";

/** Decode a QR matrix the way a phone camera would read the printed code. */
function decode(payload: string): string {
  const matrix = encodeQr(payload);
  const width = matrix.getWidth();
  const height = matrix.getHeight();
  const luminance = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      luminance[y * width + x] = matrix.get(x, y) ? 0 : 255;
    }
  }
  const source = new RGBLuminanceSource(luminance, width, height);
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
}

describe("encodeQr", () => {
  it("produces a code that decodes back to the Wi-Fi payload", () => {
    const payload = buildWifiQr({
      ssid: 'Cafe;"5G"',
      password: "pa:ss;word",
      security: "WPA",
      hidden: false,
    });
    expect(decode(payload)).toBe(payload);
    expect(parseWifiQr(decode(payload)).password).toBe("pa:ss;word");
  });

  it("keeps non-ASCII network names intact", () => {
    const payload = buildWifiQr({ ssid: "咖啡店", password: "", security: "nopass", hidden: false });
    expect(parseWifiQr(decode(payload)).ssid).toBe("咖啡店");
  });
});
