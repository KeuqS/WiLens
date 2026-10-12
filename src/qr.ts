export type WifiSecurity = "WPA" | "WEP" | "nopass";

export interface WifiPayload {
  ssid: string;
  password?: string;
  security: WifiSecurity;
  hidden: boolean;
  raw: string;
}

export function parseWifiQr(raw: string): WifiPayload {
  if (!raw.startsWith("WIFI:")) {
    throw new Error("QR code is not a Wi-Fi payload.");
  }

  const body = raw.slice(5);
  const fields = splitFields(body);
  const values = new Map<string, string>();

  for (const field of fields) {
    if (!field) {
      continue;
    }

    const separatorIndex = findSeparator(field);
    if (separatorIndex === -1) {
      continue;
    }

    const key = field.slice(0, separatorIndex);
    const value = unescapeWifiValue(field.slice(separatorIndex + 1));
    values.set(key, value);
  }

  const ssid = values.get("S") ?? "";
  if (!ssid.trim()) {
    throw new Error("Wi-Fi QR code is missing the SSID.");
  }

  const password = values.get("P") ?? "";
  const rawType = values.get("T")?.trim() ?? "";
  // A missing or empty security type is ambiguous. Infer it: a payload that
  // carries a password is almost certainly secured, while one without is open.
  const security =
    rawType === "" ? (password ? "WPA" : "nopass") : normalizeSecurity(rawType);
  const hidden = (values.get("H") ?? "").toLowerCase() === "true";

  if (security !== "nopass" && !password) {
    throw new Error("Wi-Fi QR code is missing the password.");
  }

  return {
    ssid,
    password: security === "nopass" ? undefined : password,
    security,
    hidden,
    raw,
  };
}

// Bidi controls and zero-width characters render invisibly or reorder text,
// so a QR code could make the shown network name differ from the one joined.
const INVISIBLE_CHARACTERS = /[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Make invisible or direction-changing characters visible as `⟨U+XXXX⟩`. */
export function revealInvisible(text: string): string {
  return text.replace(
    INVISIBLE_CHARACTERS,
    (char) => `⟨U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟩`,
  );
}

function normalizeSecurity(value: string): WifiSecurity {
  const normalized = value.toUpperCase();

  if (normalized === "WEP") {
    return normalized;
  }

  // WPA2/WPA3 generators (Android emits "SAE" for WPA3) all join the same way.
  if (["WPA", "WPA2", "WPA3", "SAE"].includes(normalized)) {
    return "WPA";
  }

  if (normalized === "NOPASS" || normalized === "") {
    return "nopass";
  }

  throw new Error(`Unsupported Wi-Fi security type '${value}'.`);
}

function splitFields(input: string): string[] {
  const fields: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }

    if (char === ";") {
      fields.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current) {
    fields.push(current);
  }

  return fields;
}

function findSeparator(field: string): number {
  let escaped = false;

  for (let index = 0; index < field.length; index += 1) {
    const char = field[index];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === ":") {
      return index;
    }
  }

  return -1;
}

function unescapeWifiValue(value: string): string {
  let unescaped = "";
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      unescaped += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    unescaped += char;
  }

  return unescaped;
}
