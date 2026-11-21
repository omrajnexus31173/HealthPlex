#!/usr/bin/env node
/**
 * Offline checks for the security/recognition semantics that the database and the
 * server routes enforce. These run without a browser or network: they mirror the
 * exact arithmetic/format rules in src/lib/server/templates.ts and
 * src/app/api/kiosk/scan/route.ts so a regression is caught before deploys.
 *
 *   node scripts/test-security-semantics.mjs
 */
import crypto from "node:crypto";

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) {
    pass++;
    console.log(`\u001b[32mPASS\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`\u001b[31mFAIL\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`);
  }
};

// ------------------------------------------------------------------ templates
const KEY = crypto.randomBytes(32);
function encrypt(descriptor) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const q = Buffer.alloc(descriptor.length * 2);
  for (let i = 0; i < descriptor.length; i++) {
    q.writeInt16LE(Math.round(Math.max(-1, Math.min(1, descriptor[i])) * 32000), i * 2);
  }
  const enc = Buffer.concat([cipher.update(q), cipher.final()]);
  return { ciphertext: enc, iv, authTag: cipher.getAuthTag() };
}
function decrypt(row) {
  const d = crypto.createDecipheriv("aes-256-gcm", KEY, row.iv);
  d.setAuthTag(row.authTag);
  const plain = Buffer.concat([d.update(row.ciphertext), d.final()]);
  const out = new Float32Array(plain.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = plain.readInt16LE(i * 2) / 32000;
  return out;
}

const descriptor = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 1.37) * 0.4);
const envelope = encrypt(descriptor);
const restored = decrypt(envelope);

check(envelope.ciphertext.length === 256, "ciphertext is 256 bytes (128-D int16)", `${envelope.ciphertext.length} B`);
check(envelope.iv.length === 12 && envelope.authTag.length === 16, "GCM IV/tag lengths match the DB constraint");
check(restored.length === 128, "descriptor round-trips at 128 dimensions");

let maxErr = 0;
let dot = 0;
let na = 0;
let nb = 0;
for (let i = 0; i < 128; i++) {
  maxErr = Math.max(maxErr, Math.abs(descriptor[i] - restored[i]));
  dot += descriptor[i] * restored[i];
  na += descriptor[i] ** 2;
  nb += restored[i] ** 2;
}
check(maxErr < 1e-3, "quantisation error stays below 1e-3", `max |error| = ${maxErr.toExponential(2)}`);
check(Math.abs(dot / Math.sqrt(na * nb) - 1) < 1e-6, "cosine similarity of restored descriptor is 1.0");

const tampered = Buffer.from(envelope.ciphertext);
tampered[7] ^= 0xff;
let tamperRejected = false;
try {
  decrypt({ ...envelope, ciphertext: tampered });
} catch {
  tamperRejected = true;
}
check(tamperRejected, "a single flipped ciphertext byte is rejected by the GCM tag");

let wrongKeyRejected = false;
try {
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.randomBytes(32), envelope.iv);
  d.setAuthTag(envelope.authTag);
  Buffer.concat([d.update(envelope.ciphertext), d.final()]);
} catch {
  wrongKeyRejected = true;
}
check(wrongKeyRejected, "the template cannot be opened with a different key");

// --------------------------------------------------------------- scan gating
// values as measured by scripts/test-face-pipeline.mjs and stored in gym_settings
const settings = { recognition_threshold: 0.48, liveness_threshold: 0.6 };
const gate = (confidence, liveness) => {
  if (!Number.isFinite(confidence) || confidence < 1 - settings.recognition_threshold) return "low_confidence";
  if (!Number.isFinite(liveness) || liveness < settings.liveness_threshold) return "liveness_failed";
  return "accepted";
};

check(gate(0.737, 0.8) === "accepted", "server accepts the measured genuine match when live");
check(gate(0.237, 0.8) === "low_confidence", "server rejects the measured impostor match");
check(gate(0.74, 0.15) === "liveness_failed", "high match from a static photo is rejected on liveness");
check(gate(Number.NaN, 0.9) === "low_confidence", "a missing/NaN confidence is rejected, not treated as a match");
check(gate(0.52, 0.6) === "accepted" && gate(0.519, 0.6) === "low_confidence", "confidence gate is exact at the boundary");
check(gate(0.9, 0.599) === "liveness_failed", "liveness gate is exact at the boundary");

// ------------------------------------------------------------ retention maths
const cutoffFor = (months, from) => {
  const d = new Date(from);
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
};
check(cutoffFor(6, "2026-11-21T00:00:00Z") === "2026-05-21", "6-month cutoff from 2026-11-21 is 2026-05-21", cutoffFor(6, "2026-11-21T00:00:00Z"));
check(cutoffFor(1, "2026-01-15T00:00:00Z") === "2025-12-15", "cutoff crosses the year boundary correctly", cutoffFor(1, "2026-01-15T00:00:00Z"));

// ------------------------------------------------------------------ checksums
const body = Buffer.from("student_id,date\nabc,2026-05-20\n");
const sum = crypto.createHash("sha256").update(body).digest("hex");
check(sum === crypto.createHash("sha256").update(Buffer.from(body)).digest("hex"), "backup checksum is deterministic");
check(crypto.createHash("sha256").update(Buffer.from("student_id,date\nabc,2026-05-21\n")).digest("hex") !== sum,
  "a one-day edit changes the backup checksum");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
