/**
 * Crypto helpers built on WebCrypto only, so the exact same code runs in Node
 * (dev) and in the Cloudflare Workers runtime (deployed).
 */

const encoder = new TextEncoder();

export function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return bytesToB64url(buffer);
}

export function randomCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buffer = new Uint8Array(length);
  crypto.getRandomValues(buffer);
  let out = "";
  for (const byte of buffer) out += alphabet[byte % alphabet.length];
  return out;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ------------------------------------------------------------------ QR token
// token = <32 hex chars of the participant uuid>.<22 char HMAC-SHA256 sig>
// The signature is verified server-side; a screenshot of someone else's pass
// still verifies, so the scan screen also shows name + team for a sanity check.

function qrSecret(): string {
  const secret = process.env.QR_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("QR_SECRET is not configured (min 16 chars). See .env.example.");
  }
  return secret;
}

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(qrSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToB64url(new Uint8Array(signature).slice(0, 16));
}

export function compactUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

export function expandUuid(compact: string): string | null {
  const hex = compact.toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function signQrToken(participantId: string): Promise<string> {
  const payload = compactUuid(participantId);
  return `${payload}.${await hmac(payload)}`;
}

export async function verifyQrToken(token: string): Promise<string | null> {
  const trimmed = token.trim();
  const dot = trimmed.indexOf(".");
  if (dot < 0) return null;
  const payload = trimmed.slice(0, dot);
  const signature = trimmed.slice(dot + 1);
  const uuid = expandUuid(payload);
  if (!uuid) return null;
  const expected = await hmac(payload);
  if (!timingSafeEqual(expected, signature)) return null;
  return uuid;
}

// -------------------------------------------------------------- passwords
const PASSWORD_ITERATIONS = 120_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PASSWORD_ITERATIONS}$${bytesToB64url(salt)}$${bytesToB64url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationsRaw, saltRaw, hashRaw] = stored.split("$");
  if (scheme !== "pbkdf2" || !saltRaw || !hashRaw) return false;
  const iterations = Number(iterationsRaw);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = new Uint8Array(b64urlToBytes(saltRaw));
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return timingSafeEqual(bytesToB64url(new Uint8Array(bits)), hashRaw);
}
