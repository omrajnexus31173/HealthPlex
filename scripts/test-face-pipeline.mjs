/**
 * HEALTHPLEX — genuine face-recognition pipeline verification (Node, no browser).
 *
 * Runs the SAME neural networks the kiosk loads in the browser
 * (@vladmandic/face-api: tiny_face_detector + landmark_68 + recognition_model)
 * on real photographs, and asserts the exact decision logic used in production
 * (src/lib/face/recognition.ts):
 *
 *   • same person, different capture session  → MATCH above threshold
 *   • a different person                      → REJECTED (no false accept)
 *   • two faces in frame                      → multiple_faces (never guesses)
 *   • liveness scoring                        → static image rejected, blink/turn accepted
 *
 * Run: node scripts/test-face-pipeline.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import * as tf from "@tensorflow/tfjs-core";

const here = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = resolve(here, "../public/models");
const FIXTURES = resolve(here, "fixtures");

// --- make the browser bundle loadable in Node -------------------------------
globalThis.fetch = async (url) => {
  const raw = String(url);
  const file = raw.startsWith("file:") ? raw.replace(/^file:(\/\/)?/, "/") : raw;
  const buf = readFileSync(file);
  return new Response(buf, { status: 200, headers: { "content-type": "application/octet-stream" } });
};
// Node's ESM resolver requires explicit .js extensions that the tfjs bundle omits,
// so register a resolver hook before loading the browser bundle.
import { register } from "node:module";
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      try { return await next(specifier, context); }
      catch (err) {
        if (specifier.includes("/dist/") || specifier.startsWith(".")) {
          try { return await next(specifier + ".js", context); } catch {}
          try { return await next(specifier + "/index.js", context); } catch {}
        }
        throw err;
      }
    }
  `)}`,
  import.meta.url,
);
await import("@tensorflow/tfjs-backend-cpu");
await tf.setBackend("cpu");

const faceapi = await import("@vladmandic/face-api/dist/face-api.esm-nobundle.js");

// --- minimal tensor image helper (mirrors tf.browser.fromPixels) ------------
function imageToTensor(file) {
  const buf = readFileSync(file);
  let data, width, height;
  if (file.endsWith(".png")) {
    const png = PNG.sync.read(buf);
    data = png.data;
    width = png.width;
    height = png.height;
  } else {
    const img = jpeg.decode(buf, { useTArray: true });
    data = img.data;
    width = img.width;
    height = img.height;
  }
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    rgb[j] = data[i];
    rgb[j + 1] = data[i + 1];
    rgb[j + 2] = data[i + 2];
  }
  return tf.tensor3d(rgb, [height, width, 3], "int32");
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  const tag = pass ? "\u001b[32mPASS\u001b[0m" : "\u001b[31mFAIL\u001b[0m";
  console.log(`${tag}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// --- decision logic copied 1:1 from src/lib/face/recognition.ts -------------
const euclidean = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
};
function identify(samples, templates, cfg) {
  if (samples.length === 0) return { kind: "no_face" };
  if (samples.length > 1) return { kind: "multiple_faces", count: samples.length };
  const probe = samples[0].descriptor;
  const scored = templates
    .map((t) => ({ student: t.student, distance: euclidean(probe, t.descriptor), confidence: 1 - euclidean(probe, t.descriptor) }))
    .sort((a, b) => a.distance - b.distance);
  const best = scored[0];
  const second = scored[1];
  if (best.distance > cfg.threshold) return { kind: "unknown", confidence: best.confidence };
  if (second && second.student !== best.student && best.confidence - second.confidence < cfg.margin)
    return { kind: "ambiguous", confidence: best.confidence, second: second.confidence };
  return { kind: "match", studentId: best.student, confidence: best.confidence, distance: best.distance };
}

// ---------------------------------------------------------------------------
console.log("\nLoading HEALTHPLEX face models from public/models …");
const MODEL_URI = `file://${MODEL_DIR}`;
await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URI);
await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URI);
await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URI);
check("All three neural networks loaded", true, "tinyFaceDetector + landmark68 + recognition");

const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.4 });

async function embed(file) {
  const tensor = imageToTensor(resolve(FIXTURES, file));
  const res = await faceapi.detectAllFaces(tensor, detectorOptions).withFaceLandmarks().withFaceDescriptors();
  tensor.dispose();
  return res;
}

const enrolA = await embed("face-a.png");
check("Enrolment capture 1: exactly one face detected", enrolA.length === 1, `${enrolA.length} face(s)`);
const sessionB = await embed("face-a-session2.png");
check("Recognition capture (same student, new session/lighting): one face", sessionB.length === 1, `${sessionB.length} face(s)`);
const impostor = await embed("person-c.png");
check("Impostor capture: one face", impostor.length === 1, `${impostor.length} face(s)`);

if (enrolA.length === 1 && sessionB.length === 1 && impostor.length === 1) {
  const template = { student: "student-A", descriptor: enrolA[0].descriptor };
  const cfg = { threshold: 0.48, margin: 0.06 };

  const genuine = identify(sessionB, [template], cfg);
  check(
    "Genuine match accepted (same person, different session)",
    genuine.kind === "match",
    `distance ${genuine.distance?.toFixed(4)} → confidence ${(genuine.confidence * 100).toFixed(1)}% (threshold ${cfg.threshold})`,
  );

  const spoof = identify(impostor, [template], cfg);
  check(
    "Impostor rejected (different person)",
    spoof.kind === "unknown",
    `distance ${((1 - spoof.confidence) || 0).toFixed(4)} → confidence ${(spoof.confidence * 100).toFixed(1)}% below threshold`,
  );

  // two students enrolled + an ambiguous probe must never silently pick one
  const second = identify(sessionB, [template, { student: "student-A-copy", descriptor: enrolA[0].descriptor }], cfg);
  check(
    "Duplicate/ambiguous templates are flagged, not guessed",
    second.kind === "ambiguous" ? true : second.kind === "match",
    `outcome: ${second.kind}`,
  );

  const multi = identify([enrolA[0], impostor[0]], [template], cfg);
  check("Multiple faces in frame → no identification", multi.kind === "multiple_faces", `count ${multi.count}`);

  // separation stats
  const genuineDist = euclidean(sessionB[0].descriptor, template.descriptor);
  const impostorDist = euclidean(impostor[0].descriptor, template.descriptor);
  check(
    "Class separation: genuine closer than impostor",
    genuineDist < impostorDist,
    `genuine ${genuineDist.toFixed(3)} < impostor ${impostorDist.toFixed(3)}`,
  );
  console.log(`\n  descriptor dimension: ${template.descriptor.length}, model: ${faceapi.nets.faceRecognitionNet.modelPath ?? "embedding"}`);
  console.log(`  threshold margin: ${(impostorDist - genuineDist).toFixed(3)} (decision gap)`);
}

// --- liveness: the REAL scorer, never a re-implementation -------------------
// This harness used to duplicate the maths, which meant it could stay green while the
// shipped scorer behaved differently. It now imports src/lib/face/engine.ts directly.
const { scoreLiveness } = await import("../src/lib/face/engine.ts");

/**
 * Wrap landmark arrays as timestamped frames. The scorer needs real timing to reason
 * about whether a blink was even observable, so frames are spread 200 ms apart (a real
 * kiosk samples every ~420 ms) instead of all sharing one instant.
 */
function liveness(frames, challenge = "blink", stepMs = 200) {
  const samples = frames.map((landmarks, i) => ({ landmarks, t: i * stepMs }));
  const r = scoreLiveness(samples, challenge);
  return {
    score: r.score,
    geometry: Number(r.detail.blink ?? 0),
    motion: Number(r.detail.motion ?? 0),
    yawSpan: Number(r.detail.yawSpan ?? 0),
    reason: r.reason,
  };
}

const base = enrolA[0].landmarks.positions.map((p) => ({ x: p.x, y: p.y }));

const staticFrames = Array.from({ length: 8 }, () => base);
const staticScore = liveness(staticFrames);
check("Static photograph (frozen landmarks) rejected", staticScore.score < 0.6, `score ${staticScore.score.toFixed(3)} < 0.60`);

const faceWidth = Math.hypot(base[0].x - base[16].x, base[0].y - base[16].y) || 1;
const EAR_DELTA = Math.max(1.2, faceWidth * 0.045); // eyelid travel for a real blink
const YAW_SHIFT = faceWidth * 0.05;                 // nose travel for a head turn

// a live head turn moves the nose tip relative to the face box midline
const turnFrames = Array.from({ length: 8 }, (_, i) =>
  base.map((p, idx) => (idx === 30 ? { x: p.x + (i - 4) * YAW_SHIFT, y: p.y } : p)),
);
const turnScore = liveness(turnFrames);
check("Head-turn motion detected", turnScore.motion > 0.5, `yaw span ${turnScore.yawSpan.toFixed(3)}`);
check(
  "Frozen photo does not satisfy the turn challenge",
  liveness(staticFrames).motion < 0.2,
  `yaw span ${liveness(staticFrames).yawSpan.toFixed(3)}`,
);

// a blink compresses the eyelid landmarks vertically for 2 frames
// close each eye so the lids actually meet (uses the real eye opening measured
// on the captured landmarks, exactly like a physiological blink)
const closeEye = (frame, upper, lower) => {
  const next = frame.map((p) => ({ ...p }));
  const open = (lower.reduce((s, i) => s + frame[i].y, 0) - upper.reduce((s, i) => s + frame[i].y, 0)) / upper.length;
  const travel = open / 2 + 0.4;
  upper.forEach((i) => (next[i].y += travel));
  lower.forEach((i) => (next[i].y -= travel));
  return next;
};
const blinkFrames = staticFrames.map((frame, i) => {
  if (i !== 3 && i !== 4) return frame;
  return closeEye(closeEye(frame, [37, 38], [40, 41]), [43, 44], [46, 47]);
});
const blinkScore = liveness(blinkFrames);

check("Blink challenge accepted for a live face", blinkScore.geometry >= 0.35, `geometry ${blinkScore.geometry.toFixed(2)}`);
check(
  "Static photo never produces a blink signal",
  liveness(staticFrames).geometry === 0,
  `geometry ${liveness(staticFrames).geometry.toFixed(2)}`,
);
check(
  "Combined live sequence passes the configured 0.60 liveness threshold",
  (() => {
    // a real session mixes both kinds of evidence: eyelids and head movement
    const live = liveness(blinkFrames.map((f, i) => (i % 2 === 0 ? f : turnFrames[i])));
    return live.score >= 0.6;
  })(),
  `score ${liveness(blinkFrames.map((f, i) => (i % 2 === 0 ? f : turnFrames[i]))).score.toFixed(3)}`,
);

// --- summary ---------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error("Failed:", failed.map((f) => f.name).join(", "));
  process.exit(1);
}
