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

export function decryptDescriptor(row: { ciphertext: string; iv: string; auth_tag?: string; authTag?: string; dimension?: number }): Float32Array {
  const tag = row.auth_tag ?? row.authTag;
  if (!tag) throw new Error("missing auth tag");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(row.iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  // Supabase returns bytea as \x-hex strings
  const ctRaw = row.ciphertext.startsWith("\\x")
    ? Buffer.from(row.ciphertext.slice(2), "hex")
    : Buffer.from(row.ciphertext, "base64");
  const plain = Buffer.concat([decipher.update(ctRaw), decipher.final()]);
  const dim = Math.floor(plain.length / 2);
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
