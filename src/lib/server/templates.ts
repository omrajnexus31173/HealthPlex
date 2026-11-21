import crypto from "node:crypto";

/**
 * Biometric template envelope encryption (AES-256-GCM).
 *
 * Templates are stored only as ciphertext in `face_templates`; the data key lives
 * exclusively in the server environment (`HEALTHPLEX_TEMPLATE_KEY`) and is never
 * shipped to the browser. Each template has its own random IV; the GCM auth tag
 * detects tampering. `keyVersion` allows key rotation without a schema change.
 */
const KEY_VERSION = 1;

function key(): Buffer {
  const raw = process.env.HEALTHPLEX_TEMPLATE_KEY;
  if (!raw) throw new Error("HEALTHPLEX_TEMPLATE_KEY is not configured");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("HEALTHPLEX_TEMPLATE_KEY must be 32 bytes (base64)");
  return buf;
}

export type EncryptedTemplate = { ciphertext: string; iv: string; authTag: string; keyVersion: number };

export function encryptDescriptor(descriptor: Float32Array): EncryptedTemplate {
  if (descriptor.length !== 128) throw new Error("descriptor must be 128-dimensional");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  // quantise to int16 to keep templates compact (~256 bytes) with sub-1e-3 error
  const quantised = Buffer.alloc(descriptor.length * 2);
  for (let i = 0; i < descriptor.length; i++) {
    const v = Math.max(-1, Math.min(1, descriptor[i]));
    quantised.writeInt16LE(Math.round(v * 32000), i * 2);
  }
  const encrypted = Buffer.concat([cipher.update(quantised), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: KEY_VERSION,
  };
}

export const TEMPLATE_IV_BYTES = 12;
export const TEMPLATE_TAG_BYTES = 16;
export const TEMPLATE_CIPHERTEXT_BYTES = 256;

/**
 * Decode a `bytea` column into bytes, tolerating every shape it can arrive in.
 *
 * PostgREST returns `bytea` as a Postgres *text* literal, i.e. `\\x8cc28a0f...`. The
 * original code stripped that prefix for the ciphertext but not for `iv`/`auth_tag`,
 * so the 16-byte GCM tag was base64-decoded from a hex string into 20 bytes and every
 * decryption died with "Invalid authentication tag length: 20". In production that
 * surfaced as a kiosk showing "Templates: 0" with `kiosk.template_decrypt_failed`
 * audit rows, while the template itself was perfectly valid.
 *
 * `expectedLength` makes the parse deterministic instead of heuristic: candidates are
 * tried and exactly one must produce the right number of bytes. Accepted forms:
 * Buffer/Uint8Array, `\\x`+hex, bare hex, base64, or a JSON byte array.
 */
export function byteaToBuffer(value: unknown, field: string, expectedLength?: number): Buffer {
  const candidates: Buffer[] = [];
  const add = (b: Buffer) => {
    if (expectedLength == null || b.length === expectedLength) candidates.push(b);
  };

  if (Buffer.isBuffer(value)) add(value);
  else if (value instanceof Uint8Array) add(Buffer.from(value));
  else if (Array.isArray(value)) add(Buffer.from(value.map((n) => Number(n) & 0xff)));
  else if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      const hex = value.slice(2);
      if (hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) throw new Error(`${field} has an invalid hex literal`);
      add(Buffer.from(hex, "hex"));
    } else {
      // PostgREST has been known to drop the prefix; try hex, then base64
      if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) add(Buffer.from(value, "hex"));
      add(Buffer.from(value, "base64"));
    }
  } else {
    throw new Error(`${field} is not bytea-like (${typeof value})`);
  }

  if (candidates.length === 0) {
    const hint = expectedLength == null ? "" : ` (expected ${expectedLength} bytes)`;
    throw new Error(`${field} did not decode to a valid bytea value${hint}`);
  }
  // prefer the first candidate: prefix-aware hex beats base64, matching PostgREST
  const chosen = candidates[0];
  if (candidates.some((c) => !c.equals(chosen))) {
    throw new Error(`${field} is ambiguous: hex and base64 interpretations differ`);
  }
  return chosen;
}

export function decryptDescriptor(row: {
  ciphertext: unknown;
  iv: unknown;
  auth_tag?: unknown;
  authTag?: unknown;
  dimension?: number;
}): Float32Array {
  const tag = row.auth_tag ?? row.authTag;
  if (tag == null) throw new Error("missing auth tag");

  const ivBytes = byteaToBuffer(row.iv, "iv", TEMPLATE_IV_BYTES);
  const tagBytes = byteaToBuffer(tag, "auth_tag", TEMPLATE_TAG_BYTES);
  const ctBytes = byteaToBuffer(row.ciphertext, "ciphertext", TEMPLATE_CIPHERTEXT_BYTES);

  // fail with a precise message instead of an opaque crypto error
  if (ivBytes.length !== TEMPLATE_IV_BYTES) throw new Error(`iv must be ${TEMPLATE_IV_BYTES} bytes, got ${ivBytes.length}`);
  if (tagBytes.length !== TEMPLATE_TAG_BYTES) throw new Error(`auth_tag must be ${TEMPLATE_TAG_BYTES} bytes, got ${tagBytes.length}`);
  if (ctBytes.length !== TEMPLATE_CIPHERTEXT_BYTES) throw new Error(`ciphertext must be ${TEMPLATE_CIPHERTEXT_BYTES} bytes, got ${ctBytes.length}`);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), ivBytes);
  decipher.setAuthTag(tagBytes);
  const plain = Buffer.concat([decipher.update(ctBytes), decipher.final()]);
  const dim = plain.length / 2;
  if (!Number.isInteger(dim) || dim !== 128) throw new Error(`descriptor must be 128-D, got ${dim}`);
  const out = new Float32Array(dim);
  for (let i = 0; i < dim; i++) out[i] = plain.readInt16LE(i * 2) / 32000;
  return out;
}

export function toByteaHex(b64: string): string {
  return `\\x${Buffer.from(b64, "base64").toString("hex")}`;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
