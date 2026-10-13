import { describe, expect, it } from "vitest";
import { buildWifiQr, parseWifiQr, revealInvisible } from "./qr";

describe("parseWifiQr", () => {
  it("parses a standard WPA payload", () => {
    const payload = parseWifiQr("WIFI:T:WPA;S:MyWifi;P:mypassword;;");

    expect(payload.ssid).toBe("MyWifi");
    expect(payload.security).toBe("WPA");
    expect(payload.password).toBe("mypassword");
    expect(payload.hidden).toBe(false);
  });

  it("parses a WEP payload", () => {
    const payload = parseWifiQr("WIFI:T:WEP;S:OldNet;P:secret;;");

    expect(payload.security).toBe("WEP");
    expect(payload.password).toBe("secret");
  });

  it("normalizes lowercase security types", () => {
    const payload = parseWifiQr("WIFI:T:wpa;S:Net;P:pw;;");

    expect(payload.security).toBe("WPA");
  });

  it.each(["WPA2", "WPA3", "SAE", "sae"])("treats %s as WPA", (type) => {
    const payload = parseWifiQr(`WIFI:T:${type};S:Net;P:pw;;`);

    expect(payload.security).toBe("WPA");
  });

  it("treats fields in any order", () => {
    const payload = parseWifiQr("WIFI:S:Net;P:pw;T:WPA;;");

    expect(payload.ssid).toBe("Net");
    expect(payload.password).toBe("pw");
    expect(payload.security).toBe("WPA");
  });

  describe("open networks", () => {
    it("parses an explicit nopass network without a password", () => {
      const payload = parseWifiQr("WIFI:T:nopass;S:OpenNet;;");

      expect(payload.security).toBe("nopass");
      expect(payload.password).toBeUndefined();
    });

    it("treats a missing security type as nopass when no password is present", () => {
      const payload = parseWifiQr("WIFI:S:OpenNet;;");

      expect(payload.security).toBe("nopass");
      expect(payload.password).toBeUndefined();
    });

    it("drops any password supplied for a nopass network", () => {
      const payload = parseWifiQr("WIFI:T:nopass;S:OpenNet;P:ignored;;");

      expect(payload.security).toBe("nopass");
      expect(payload.password).toBeUndefined();
    });
  });

  describe("hidden flag", () => {
    it("reads H:true", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pw;H:true;;");

      expect(payload.hidden).toBe(true);
    });

    it("is case-insensitive for the hidden flag", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pw;H:True;;");

      expect(payload.hidden).toBe(true);
    });

    it("defaults hidden to false", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pw;;");

      expect(payload.hidden).toBe(false);
    });

    it("treats an empty hidden flag as false", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pw;H:;;");

      expect(payload.hidden).toBe(false);
    });
  });

  describe("real-world payload variations", () => {
    it("accepts a payload without the optional trailing terminator", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pw12345678");

      expect(payload.ssid).toBe("Net");
      expect(payload.password).toBe("pw12345678");
    });

    it("keeps field keys case-sensitive", () => {
      expect(() => parseWifiQr("WIFI:t:WPA;s:Net;p:pw12345678;;")).toThrow(
        /missing the SSID/i,
      );
    });

    it("preserves Unicode SSIDs from a raw payload", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Café ☕;P:pw12345678;;");

      expect(payload.ssid).toBe("Café ☕");
    });
  });

  describe("escaped characters", () => {
    it("unescapes a semicolon in the password", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pa\\;ss;;");

      expect(payload.password).toBe("pa;ss");
    });

    it("unescapes a colon in the SSID", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:My\\:Net;P:pw;;");

      expect(payload.ssid).toBe("My:Net");
    });

    it("unescapes a backslash", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:Net;P:pa\\\\ss;;");

      expect(payload.password).toBe("pa\\ss");
    });

    it("unescapes a comma", () => {
      const payload = parseWifiQr("WIFI:T:WPA;S:My\\,Net;P:pw;;");

      expect(payload.ssid).toBe("My,Net");
    });
  });

  describe("malformed payloads", () => {
    it("rejects a non-Wi-Fi payload", () => {
      expect(() => parseWifiQr("https://example.com")).toThrow(
        /not a Wi-Fi payload/i,
      );
    });

    it("rejects a payload missing the SSID", () => {
      expect(() => parseWifiQr("WIFI:T:WPA;P:pw;;")).toThrow(/missing the SSID/i);
    });

    it("rejects a payload with a blank SSID", () => {
      expect(() => parseWifiQr("WIFI:T:WPA;S: ;P:pw;;")).toThrow(
        /missing the SSID/i,
      );
    });

    it("rejects a secured network with no password", () => {
      expect(() => parseWifiQr("WIFI:T:WPA;S:Net;;")).toThrow(
        /missing the password/i,
      );
    });

    it("rejects an unsupported security type", () => {
      expect(() => parseWifiQr("WIFI:T:WPA3-ENT;S:Net;P:pw;;")).toThrow(
        /Unsupported Wi-Fi security type/i,
      );
    });
  });
});

describe("revealInvisible", () => {
  it("leaves ordinary names unchanged", () => {
    expect(revealInvisible("Café 5G")).toBe("Café 5G");
  });

  it("shows bidi and zero-width characters as code points", () => {
    expect(revealInvisible("Home‮gnp.exe")).toBe("Home⟨U+202E⟩gnp.exe");
    expect(revealInvisible("Ca​fe")).toBe("Ca⟨U+200B⟩fe");
  });
});

describe("buildWifiQr", () => {
  const base = { ssid: "Cafe", password: "pw12345678", security: "WPA" as const, hidden: false };

  it("builds a standard WPA payload", () => {
    expect(buildWifiQr(base)).toBe("WIFI:T:WPA;S:Cafe;P:pw12345678;;");
  });

  it("omits the password for open networks and marks hidden ones", () => {
    expect(buildWifiQr({ ...base, security: "nopass", hidden: true })).toBe(
      "WIFI:T:nopass;S:Cafe;H:true;;",
    );
  });

  it("escapes reserved characters so the payload round-trips", () => {
    const input = {
      ssid: 'Cafe;Bar:"5G",\\',
      password: 'p;a:s,s"w\\rd',
      security: "WPA" as const,
      hidden: true,
    };
    const parsed = parseWifiQr(buildWifiQr(input));
    expect(parsed.ssid).toBe(input.ssid);
    expect(parsed.password).toBe(input.password);
    expect(parsed.security).toBe("WPA");
    expect(parsed.hidden).toBe(true);
  });

  it("round-trips non-ASCII network names", () => {
    expect(parseWifiQr(buildWifiQr({ ...base, ssid: "咖啡店 Wi-Fi" })).ssid).toBe("咖啡店 Wi-Fi");
  });

  it("rejects details that could not work as a real network", () => {
    expect(() => buildWifiQr({ ...base, ssid: "  " })).toThrow(/network name/i);
    expect(() => buildWifiQr({ ...base, ssid: "x".repeat(33) })).toThrow(/32 bytes/);
    expect(() => buildWifiQr({ ...base, password: "" })).toThrow(/Enter the password/);
    expect(() => buildWifiQr({ ...base, password: "short" })).toThrow(/8 to 63/);
    expect(() => buildWifiQr({ ...base, security: "WEP", password: "abcd" })).toThrow(/WEP/);
  });

  it("accepts hex keys", () => {
    expect(() => buildWifiQr({ ...base, password: "a".repeat(64) })).not.toThrow();
    expect(() => buildWifiQr({ ...base, security: "WEP", password: "0123456789" })).not.toThrow();
  });
});
