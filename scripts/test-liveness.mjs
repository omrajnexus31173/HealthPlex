#!/usr/bin/env node
/**
 * Liveness regression tests against the REAL scorer in src/lib/face/engine.ts.
 *
 * The production evidence these encode:
 *   • a genuine user scored 0.596 (threshold 0.60) and was rejected
 *   • the blink challenge answered "No blink detected" on that same genuine user
 *   • static photographs scored 0.15–0.35 and were (correctly) rejected
 *   • one identity attempt carried liveness 0.88 and confidence 0.000 (zero templates)
 *
 *   node --experimental-strip-types scripts/test-liveness.mjs
 */
import { scoreLiveness, livenessMetrics } from "../src/lib/face/engine.ts";

let pass = 0;
let fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`\u001b[32mPASS\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`); }
  else { fail++; console.log(`\u001b[31mFAIL\u001b[0m  ${label}${detail ? `  — ${detail}` : ""}`); }
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Build a synthetic but anatomically faithful 68-point face.
 *   eyeOpen  1 = wide open, 0 = shut
 *   yaw      head rotation as a fraction of face width; moves the nose tip (30) and
 *            the lower-nose points, leaving the ears where they are
 *   mouthOpen mouth height multiplier
 *   depth    >1 means leaning towards the camera: the face gets wider but is
 *            foreshortened vertically, which is exactly the cue a nod produces
 *   jitter   per-point detector noise in pixels
 */
function makeFace({ eyeOpen = 1, yaw = 0, mouthOpen = 0.35, depth = 1, jitter = 0 } = {}) {
  const pts = Array.from({ length: 68 }, () => ({ x: 0, y: 0 }));
  const W = 200 * depth;
  const H = 200 * Math.pow(depth, 0.35);
  const cx = 320;
  const cy = 240;
  const j = () => (Math.random() - 0.5) * jitter;

  // jaw 0..16 — arc from left ear to right ear. 0 and 16 stay put under yaw (they are
  // the ears), so the midline used by the metric is yaw-independent.
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const ang = Math.PI * (0.15 + 0.7 * t);
    pts[i] = { x: cx - Math.cos(ang) * W * 0.5 + j(), y: cy + Math.sin(ang) * H * 0.62 + j() };
  }
  const shift = yaw * W;
  // brows move 40% with the rotation
  for (let i = 17; i <= 26; i++) pts[i] = { x: cx + (i - 21.5) * W * 0.06 + shift * 0.4 + j(), y: cy - H * 0.22 + j() };
  // nose bridge 27..30 and lower nose 31..35 move fully with the head
  for (let i = 27; i <= 30; i++) pts[i] = { x: cx + shift + j(), y: cy - H * 0.18 + (i - 27) * H * 0.06 + j() };
  for (let i = 31; i <= 35; i++) pts[i] = { x: cx + (i - 33) * W * 0.04 + shift + j(), y: cy - H * 0.02 + j() };

  const eye = (start, xOff) => {
    const h = W * 0.13;
    const v = W * 0.055 * eyeOpen;
    const ox = cx + xOff + shift * 0.4;
    pts[start + 0] = { x: ox - h / 2, y: cy + j() };
    pts[start + 1] = { x: ox - h / 6, y: cy - v + j() };
    pts[start + 2] = { x: ox + h / 6, y: cy - v + j() };
    pts[start + 3] = { x: ox + h / 2, y: cy + j() };
    pts[start + 4] = { x: ox + h / 6, y: cy + v + j() };
    pts[start + 5] = { x: ox - h / 6, y: cy + v + j() };
  };
  eye(36, -W * 0.2);
  eye(42, W * 0.2);

  const mv = W * 0.05 * (mouthOpen + 1);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    pts[48 + i] = { x: cx + Math.cos(a) * W * 0.2 + shift * 0.5 + j(), y: cy + H * 0.28 + Math.sin(a) * mv + j() };
  }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    pts[60 + i] = { x: cx + Math.cos(a) * W * 0.12 + shift * 0.5 + j(), y: cy + H * 0.28 + Math.sin(a) * mv * 0.5 + j() };
  }
  return pts;
}

const sample = (t, opts) => ({ landmarks: makeFace(opts), t });
const seq = (n, step, fn) => Array.from({ length: n }, (_, i) => sample(i * step, fn(i)));

// ---------------------------------------------------------------- genuine live user
// open → closed for two frames → open, 200 ms apart over ~2.8 s
const blinkFrames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map((i) =>
  sample(i * 210, {
    eyeOpen: i === 6 || i === 7 ? 0.05 : 1,
    jitter: 1.5,
    yaw: Math.sin(i / 3) * 0.01,
  }),
);
const blinkResult = scoreLiveness(blinkFrames, "blink");
check(blinkResult.score >= 0.6, "genuine blink sequence passes the 0.60 threshold", `score ${blinkResult.score.toFixed(3)}`);
check(!blinkResult.reason, "genuine blink produces no failure reason", blinkResult.reason ?? "none");
check(livenessMetrics(blinkFrames).blink > 0.5, "blink evidence is detected as a class", `blink ${livenessMetrics(blinkFrames).blink.toFixed(2)}`);

// ------------------------------------------------------------- the production failure
// a real user whose eyes barely moved (autofocus hunting / low fps): old code -> 0.596
const noBlinkFrames = seq(14, 210, (i) => ({ eyeOpen: 1, jitter: 2, yaw: Math.sin(i / 4) * 0.012 }));
const noBlink = scoreLiveness(noBlinkFrames, "blink");
check(noBlink.score < 0.6, "a genuine user with no measurable blink is NOT passed", `score ${noBlink.score.toFixed(3)}`);
check(/blink/i.test(noBlink.reason ?? ""), "the reason names the missing evidence, not a generic score", noBlink.reason);

// -------------------------------------------------------- slow sampling is not a crime
// 900 ms between frames: a 150 ms blink is physically unobservable here
const slowFrames = seq(8, 900, () => ({ eyeOpen: 1, jitter: 2 }));
const slow = scoreLiveness(slowFrames, "blink");
check(/could not sample your eyes/i.test(slow.reason ?? ""), "slow frame rate asks for a re-scan instead of accusing the user", slow.reason);
check(slow.detail.blinkObservable === false, "observability is reported explicitly in the detail payload");

// ------------------------------------------------------------------ static photograph
const still = seq(12, 210, () => ({ eyeOpen: 1, jitter: 0 }));
const stillResult = scoreLiveness(still, "blink");
check(stillResult.score < 0.2, "a frozen photograph scores near zero", `score ${stillResult.score.toFixed(3)}`);
check(livenessMetrics(still).motion === 0, "a frozen photograph has zero micro-motion");

// photo of an OPEN-eyed person with landmark noise, presented to a turn challenge
const noisyPhoto = seq(12, 210, () => ({ eyeOpen: 1, jitter: 2.5 }));
const noisy = scoreLiveness(noisyPhoto, "turn_left");
check(noisy.score < 0.6, "landmark noise alone cannot satisfy a head-turn challenge", `score ${noisy.score.toFixed(3)} (yawReversal ${livenessMetrics(noisyPhoto).yawReversal.toFixed(4)})`);

// ------------------------------------------------------------- genuine head turn
const turnFrames = seq(14, 210, (i) => ({ eyeOpen: 1, jitter: 1.2, yaw: i < 7 ? i * 0.02 : (14 - i) * 0.02 }));
const turn = scoreLiveness(turnFrames, "turn_left");
check(turn.score >= 0.6, "a genuine left-and-back head turn passes", `score ${turn.score.toFixed(3)}`);
check(livenessMetrics(turnFrames).yawReversal >= 0.02, "the turn is measured as a reversal, not a held pose", `yawReversal ${livenessMetrics(turnFrames).yawReversal.toFixed(3)}`);

// a photo tilted at a fixed angle (no reversal) must fail the turn challenge
const heldPose = seq(12, 210, () => ({ eyeOpen: 1, jitter: 0.5, yaw: 0.08 }));
const held = scoreLiveness(heldPose, "turn_left");
check(held.score < 0.6, "a held pose (no return to centre) fails the turn challenge", `score ${held.score.toFixed(3)}`);

// -------------------------------------------------------------------------- smile
const smileFrames = seq(14, 210, (i) => ({ eyeOpen: 1, jitter: 1.2, mouthOpen: i > 6 ? 0.95 : 0.2 }));
const smile = scoreLiveness(smileFrames, "smile");
check(smile.score >= 0.6, "a genuine smile passes", `score ${smile.score.toFixed(3)}`);

// --------------------------------------------------------------------------- nod
const nodFrames = seq(14, 210, (i) => ({ eyeOpen: 1, jitter: 1, depth: i > 6 ? 1.18 : 1 }));
const nod = scoreLiveness(nodFrames, "nod");
check(nod.score >= 0.6, "a genuine nod (depth change) passes", `score ${nod.score.toFixed(3)}`);

// ------------------------------------------------------------------ stale evidence
// a blink from 10 s ago must not authenticate today's scan
const stale = [
  ...Array.from({ length: 6 }, (_, i) => sample(i * 200, { eyeOpen: i === 2 || i === 3 ? 0.05 : 1, jitter: 1 })),
  ...Array.from({ length: 5 }, (_, i) => sample(9000 + i * 200, { eyeOpen: 1, jitter: 0.2 })),
];
const staleResult = scoreLiveness(stale, "blink");
check(staleResult.score < 0.6, "a blink older than the evidence window is ignored", `score ${staleResult.score.toFixed(3)}`);

// ------------------------------------------------------------------- degenerate input
check(scoreLiveness([], "blink").score === 0, "no samples scores zero");
check(scoreLiveness([sample(0, {}), sample(200, {})], "blink").score === 0, "two samples are not enough evidence");
check(scoreLiveness(seq(10, 200, () => ({})), "blink").score < 0.6, "a fully static face never passes any challenge");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
