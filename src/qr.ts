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

export interface WifiShareInput {
  ssid: string;
  password: string;
  security: WifiSecurity;
  hidden: boolean;
}

const MAX_SSID_BYTES = 32;

/**
 * Build a standard `WIFI:` QR payload from details the user typed. Throws an
 * Error with a user-facing message when the details could not work as a real
 * network (so the shared code never fails on the guest's phone).
 */
export function buildWifiQr(input: WifiShareInput): string {
  const { ssid, password, security, hidden } = input;

  if (!ssid.trim()) {
    throw new Error("Enter the network name.");
  }
  if (new TextEncoder().encode(ssid).length > MAX_SSID_BYTES) {
    throw new Error("Network names can be at most 32 bytes long.");
  }

  if (security !== "nopass" && !password) {
    throw new Error("Enter the password.");
  }
  if (security === "WPA" && !isValidWpaKey(password)) {
    throw new Error("WPA passwords are 8 to 63 characters (or 64 hex digits).");
  }
  if (security === "WEP" && !isValidWepKey(password)) {
    throw new Error("WEP keys are 5 or 13 characters (or 10 or 26 hex digits).");
  }

  const fields = [`T:${security}`, `S:${escapeWifiValue(ssid)}`];
  if (security !== "nopass") {
    fields.push(`P:${escapeWifiValue(password)}`);
  }
  if (hidden) {
    fields.push("H:true");
  }

  return `WIFI:${fields.join(";")};;`;
}

function isValidWpaKey(password: string): boolean {
  return (
    (password.length >= 8 && password.length <= 63 && /^[\x20-\x7E]+$/.test(password)) ||
    /^[0-9a-fA-F]{64}$/.test(password)
  );
}

function isValidWepKey(password: string): boolean {
  return (
    ((password.length === 5 || password.length === 13) && /^[\x20-\x7E]+$/.test(password)) ||
    /^([0-9a-fA-F]{10}|[0-9a-fA-F]{26})$/.test(password)
  );
}

/** Escape the characters the `WIFI:` format reserves: `\ ; , : "`. */
function escapeWifiValue(value: string): string {
  return value.replace(/[\\;,:"]/g, "\\$&");
}
