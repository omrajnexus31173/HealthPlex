#!/usr/bin/env node
/**
 * Regression test for the production "Templates: 0" bug.
 *
 * Tests the REAL module at src/lib/server/templates.ts (compiled on the fly by tsx-less
 * `node --experimental-strip-types`), not a re-implementation, so the bytea handling
 * that broke production cannot silently drift again.
 *
 *   node --experimental-strip-types scripts/test-template-envelope.mjs
 */
import crypto from "node:crypto";

process.env.HEALTHPLEX_TEMPLATE_KEY = crypto.randomBytes(32).toString("base64");
const mod = await import("../src/lib/server/templates.ts");
const { encryptDescriptor, decryptDescriptor, byteaToBuffer } = mod;

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`\u001b[32mPASS\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`); }
  else { fail++; console.log(`\u001b[31mFAIL\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`); }
};

const descriptor = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i * 1.37) * 0.4);
const enc = encryptDescriptor(descriptor);

// ---- shape 1: bare base64, exactly as the app writes it (this always worked)
let out = decryptDescriptor({ ciphertext: enc.ciphertext, iv: enc.iv, auth_tag: enc.authTag });
check(out.length === 128, "base64 round-trip returns a 128-D descriptor");

// ---- shape 2: PostgREST text form '\\x<hex>' for ALL THREE columns.
// This is the shape that broke production: iv/auth_tag were base64-decoded from hex.
const hex = (b64) => `\\x${Buffer.from(b64, "base64").toString("hex")}`;
out = decryptDescriptor({ ciphertext: hex(enc.ciphertext), iv: hex(enc.iv), auth_tag: hex(enc.authTag) });
check(out.length === 128, "PostgREST \\x-prefixed hex round-trip returns a 128-D descriptor");

let maxErr = 0;
for (let i = 0; i < 128; i++) maxErr = Math.max(maxErr, Math.abs(descriptor[i] - out[i]));
check(maxErr < 1e-3, "hex-form descriptor is byte-identical after quantisation", `max |error| ${maxErr.toExponential(2)}`);

// ---- shape 3: mixed (prefix lost on some columns by a driver)
out = decryptDescriptor({ ciphertext: Buffer.from(enc.ciphertext, "base64"), iv: Buffer.from(enc.iv, "base64"), auth_tag: Buffer.from(enc.authTag, "base64") });
check(out.length === 128, "raw Buffer bytea values are handled");

// ---- regression guard: the exact production failure must now be impossible
const nativeIv = Buffer.from(enc.iv, "base64");
check(nativeIv.length === 12, "iv decodes to 12 bytes");
const nativeTag = Buffer.from(enc.authTag, "base64");
check(nativeTag.length === 16, "auth tag decodes to 16 bytes");
const wouldHaveBeen = Buffer.from(`\\x${nativeTag.toString("hex")}`, "base64");
check(wouldHaveBeen.length !== 16, "the old code path produced a bad tag length", `${wouldHaveBeen.length} bytes (bug reproduced)`);
let oldPathThrew = false;
try {
  const d = crypto.createDecipheriv("aes-256-gcm", crypto.randomBytes(32), wouldHaveBeen.subarray(0, 12));
  d.setAuthTag(wouldHaveBeen);
  d.final();
} catch (e) { oldPathThrew = /authentication tag length/i.test(e.message); }
check(oldPathThrew, "old path fails with 'Invalid authentication tag length' (documented root cause)");

// ---- security properties must not regress
const tampered = Buffer.from(enc.ciphertext, "base64");
tampered[9] ^= 0xff;
let tamperRejected = false;
try { decryptDescriptor({ ciphertext: tampered.toString("base64"), iv: enc.iv, auth_tag: enc.authTag }); } catch { tamperRejected = true; }
check(tamperRejected, "tampered ciphertext is rejected by the GCM tag");

// a 1-byte ciphertext in a well-formed literal must be rejected on length
let truncRejected = false;
try { decryptDescriptor({ ciphertext: "\\x00ff", iv: hex(enc.iv), auth_tag: hex(enc.authTag) }); } catch (e) { truncRejected = /ciphertext did not decode to a valid bytea value \(expected 256 bytes\)/.test(e.message); }
check(truncRejected, "subset ciphertext rejected with a precise length error, not a crypto error");

// a malformed hex literal must also be rejected precisely
let malformedRejected = false;
try { decryptDescriptor({ ciphertext: "\\x0", iv: hex(enc.iv), auth_tag: hex(enc.authTag) }); } catch (e) { malformedRejected = /invalid hex literal/.test(e.message); }
check(malformedRejected, "malformed hex literal is rejected explicitly");

let badTagRejected = false;
try { decryptDescriptor({ ciphertext: hex(enc.ciphertext), iv: hex(enc.iv), auth_tag: hex(Buffer.alloc(16, 9).toString("base64")) }); } catch { badTagRejected = true; }
check(badTagRejected, "a valid-length but wrong auth tag is rejected");

let missingTagRejected = false;
try { decryptDescriptor({ ciphertext: hex(enc.ciphertext), iv: hex(enc.iv) }); } catch { missingTagRejected = true; }
check(missingTagRejected, "a missing auth tag is rejected");

// no plaintext leakage in the stored envelope
check(!Buffer.from(enc.ciphertext, "base64").includes(Buffer.from(descriptor.buffer.slice(0, 8))), "ciphertext does not contain raw descriptor bytes");

// bytea decoder refuses to guess
let ambiguous = false;
try { byteaToBuffer("deadbeef", "iv", 12); } catch { ambiguous = true; }
check(ambiguous, "byteaToBuffer rejects a value that cannot be the expected length");

// ---------------------------------------------------------------------------
// The REAL production row (student 365e70f7-…, captured 2026-11-21), exactly as
// PostgREST serialised it. This is the case that produced nine
// kiosk.template_decrypt_failed audit rows and a kiosk stuck on "Templates: 0".
// Kept verbatim so the failure can never silently return.
// ---------------------------------------------------------------------------
const REAL = {
  iv: "\\x03a6229befd1b1e1400f7533",
  auth_tag: "\\x14d4c51adea6472a457993961579c00e",
  ciphertext:
    "\\x8cc28a0f2166e59e97f1051d234e29a1abe25369632b5494cdee0c024acc994bf1c116230e27c28f0f812efca498d2da29717e9e973a2b64ecfecc52e72bd6b624d3c2fd94abb8a742bdccba16d8051207ce42d1b23f291f06a155fcce830d3eb2af219f8eac18064c5edb92831292d2ae31a663dbc4585a36121760b27988e77fa6ab38ca52f0bcd254beee8551b7bcdb28339b7012bd6724c0f42d3b167c331b8cddf0d943c55397e8caf9a6a61b7e404c0bba503545d204008924bb62f3255cbb403a5d604b5dc986c2f8ace3d92a4f9ee92cf61b6e1a93d98aca2f74156d4dfc9c1bbb8c1ebd42df8a7e17a6266bbde7994eeb563a3f31aea81ee672783a",
};
const gcm = (iv, tag) => {
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.alloc(32), iv);
  d.setAuthTag(tag);
  return d;
};

check(
  "real production IV decodes to exactly 12 bytes",
  byteaToBuffer(REAL.iv, "iv", 12).length === 12,
  byteaToBuffer(REAL.iv, "iv", 12).toString("hex"),
);
check(
  "real production auth tag decodes to exactly 16 bytes",
  byteaToBuffer(REAL.auth_tag, "auth_tag", 16).length === 16,
  `${byteaToBuffer(REAL.auth_tag, "auth_tag", 16).length} bytes`,
);
check(
  "real production ciphertext decodes to exactly 256 bytes",
  byteaToBuffer(REAL.ciphertext, "ciphertext", 256).length === 256,
  `${byteaToBuffer(REAL.ciphertext, "ciphertext", 256).length} bytes`,
);
check(
  "the OLD base64-on-hex bug is reproduced, so this regression is real",
  (() => {
    try {
      gcm(Buffer.from(REAL.iv, "base64"), Buffer.from(REAL.auth_tag, "base64"));
      return false;
    } catch (e) {
      return e.message === "Invalid authentication tag length: 24";
    }
  })(),
  'base64-decoding a "\\x"-hex tag throws "Invalid authentication tag length: 24"',
);
check(
  "the real production envelope yields a usable AES-256-GCM decipher",
  (() => {
    gcm(byteaToBuffer(REAL.iv, "iv", 12), byteaToBuffer(REAL.auth_tag, "auth_tag", 16));
    return true;
  })(),
  "envelope accepted: 12/16/256",
);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);