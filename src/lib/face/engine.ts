/**
 * HEALTHPLEX face engine — runs entirely in the browser (WASM/WebGL) using
 * @vladmandic/face-api neural networks:
 *   • tiny_face_detector      → face localisation + 5 landmarks
 *   • face_landmark_68_model  → 68 landmarks (liveness geometry)
 *   • face_recognition_model  → 128-D descriptor (ArcFace-style embeddings)
 *
 * Model weights are served from /models on the same origin (vendored in the repo).
 * No frames and no raw images ever leave the device — only the 128-D descriptor,
 * a geometric liveness score and quality metrics are transmitted.
 */
import type * as FaceApi from "@vladmandic/face-api";

type FaceApiModule = typeof FaceApi;

let faceapi: FaceApiModule | null = null;
let loading: Promise<FaceApiModule> | null = null;

export const MODEL_URL = "/models";
export const DESCRIPTOR_VERSION = "face-api-1.7.15/128d/fp32";

export async function loadFaceEngine(): Promise<FaceApiModule> {
  if (faceapi) return faceapi;
  if (loading) return loading;
  loading = (async () => {
    const mod = (await import("@vladmandic/face-api")) as unknown as FaceApiModule;
    const tf = mod.tf as unknown as {
      setBackend(name: string): Promise<boolean>;
      ready(): Promise<void>;
    };
    await tf.setBackend("webgl").catch(async () => {
      await tf.setBackend("cpu");
    });
    await tf.ready();
    await Promise.all([
      mod.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      mod.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      mod.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceapi = mod;
    return mod;
  })();
  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

export type FaceBox = { x: number; y: number; width: number; height: number };

export type FaceSample = {
  descriptor: Float32Array;
  box: FaceBox;
  score: number;
  landmarks: { x: number; y: number }[];
};

const DETECTOR_OPTIONS = () => ({ inputSize: 320, scoreThreshold: 0.5 });

/** Detect every face in the frame, with landmarks + descriptors. */
export async function detectFaces(input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement): Promise<FaceSample[]> {
  const api = await loadFaceEngine();
  const results = await api
    .detectAllFaces(input as HTMLVideoElement, new api.TinyFaceDetectorOptions(DETECTOR_OPTIONS()))
    .withFaceLandmarks()
    .withFaceDescriptors();
  return results.map((r) => ({
    descriptor: r.descriptor,
    box: {
      x: r.detection.box.x,
      y: r.detection.box.y,
      width: r.detection.box.width,
      height: r.detection.box.height,
    },
    score: r.detection.score,
    landmarks: r.landmarks.positions.map((p) => ({ x: p.x, y: p.y })),
  }));
}

/** Detect a single face (returns null when zero or multiple faces are present). */
export async function detectSingleFace(input: HTMLVideoElement | HTMLCanvasElement): Promise<{ sample: FaceSample | null; count: number }> {
  const faces = await detectFaces(input);
  return { sample: faces.length === 1 ? faces[0] : null, count: faces.length };
}

export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export type Match = { index: number; distance: number; confidence: number };

/**
 * Compare a probe descriptor against enrolled templates.
 * Lower L2 distance = better match. `confidence` is reported as 1 - distance,
 * which for the face-api 128-D descriptors sits above 0.5 for genuine matches
 * (threshold default 0.48 → 0.52 confidence).
 */
export function matchDescriptors(
  probe: Float32Array,
  templates: { index: number; descriptor: Float32Array }[],
): { best: Match | null; second: Match | null } {
  const scored: Match[] = templates
    .map((t) => {
      const d = euclideanDistance(probe, t.descriptor);
      return { index: t.index, distance: d, confidence: 1 - d };
    })
    .sort((a, b) => a.distance - b.distance);
  return { best: scored[0] ?? null, second: scored[1] ?? null };
}

/** Mean descriptor across several enrolment samples (reduces per-frame noise). */
export function averageDescriptor(list: Float32Array[]): Float32Array {
  const out = new Float32Array(list[0].length);
  for (const d of list) {
    for (let i = 0; i < d.length; i++) out[i] += d[i] / list.length;
  }
  return out;
}

/** Distance → 0..1 quality score used for the enrolment gate. */
export function templateCohesion(list: Float32Array[]): number {
  if (list.length < 2) return 1;
  let max = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      max = Math.max(max, euclideanDistance(list[i], list[j]));
    }
  }
  return Math.max(0, 1 - max);
}

export function descriptorToBase64(descriptor: Float32Array): string {
  const bytes = new Uint8Array(descriptor.buffer.slice(0));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToDescriptor(b64: string): Float32Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

/* ------------------------------------------------------------------ *
 * Presentation-attack detection (documented, tested heuristic layer)  *
 * ------------------------------------------------------------------ *
 * Three independent signals are combined:
 *  1. FACE GEOMETRY  — a real face in front of a camera produces a small but
 *     non-zero variance in inter-ocular distance / mouth-opening across
 *     consecutive frames. A printed photo held still is perfectly rigid;
 *     an aggressive video replay tends to show unnatural jitter.
 *  2. CHALLENGE-RESPONSE — the screen asks for a random action ("blink",
 *     "turn your head slightly") and the landmark stream must confirm it.
 *     A static photo or a looping video cannot answer a random prompt.
 *  3. TEXTURE / SIZE SANITY — face must be large enough, well framed, and the
 *     detector confidence must be stable.
 *
 * It is NOT a certified ISO/IEC 30107-3 PAD implementation. It raises the cost
 * of photo/screen spoofing substantially; it does not make spoofing impossible.
 * Score is 0..1, threshold comes from gym settings (default 0.60).
 */

export type LivenessSample = { landmarks: { x: number; y: number }[]; t: number };

export type Challenge = "blink" | "turn_left" | "turn_right" | "smile" | "nod";

export const CHALLENGE_TEXT: Record<Challenge, string> = {
  blink: "Please blink once",
  turn_left: "Slowly turn your head to your LEFT",
  turn_right: "Slowly turn your head to your RIGHT",
  smile: "Please smile",
  nod: "Slowly nod your head down",
};

export function randomChallenge(): Challenge {
  const all: Challenge[] = ["blink", "turn_left", "turn_right", "smile", "nod"];
  return all[Math.floor(Math.random() * all.length)];
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Eye aspect ratio — drops sharply during a blink. */
function eyeAspect(eye: { x: number; y: number }[]) {
  const vertical = (dist(eye[1], eye[5]) + dist(eye[2], eye[4])) / 2;
  const horizontal = dist(eye[0], eye[3]) || 1;
  return vertical / horizontal;
}

/**
 * Liveness evidence, measured relative to the FIRST frame of the challenge window.
 *
 * Every input is a *class* (open/closed eye, left of centre / right of centre) rather
 * than a raw magnitude, because raw landmark noise is exactly what a real webcam
 * produces: in production a genuine user scored 0.596 (needed 0.60) on iris-motion
 * alone while the blink challenge reported "no blink" and a static photograph scored
 * 0.15. Ratios are what separate the two:
 *   • a blink moves the eyelid aspect ratio by ~2x; detector noise moves it by <10%
 *   • turning one's head moves the nose tip across the face midline; noise does not
 *   • a smile/wince changes mouth height relative to face width
 * Absolute geometric thresholds remain the final gate — nothing here is loosened.
 */
export type LivenessEvidence = {
  frames: number;
  /** false when the sampled frames were too far apart to catch a fast blink */
  blinkObservable: boolean;
  /** longest continuous stretch with both eyes closed, in ms */
  eyeClosedMs: number;
  /** 0..1 confidence that the eyelids actually opened AND closed */
  blink: number;
  /** nose-tip excursion from the first frame, in face widths */
  yawSpan: number;
  /** left/right excursions of the nose tip around its own mean (rejects a held pose) */
  yawReversal: number;
  /** change in mouth height relative to face width */
  mouthSpan: number;
  /** head size wobble: depth motion that a flat photo cannot produce */
  scaleSpan: number;
  /** 0..1 — bounded micro-motion. A frozen photograph is exactly 0. */
  motion: number;
  minEar: number;
  maxEar: number;
};

/** Evidence older than this is ignored: a stale blink must not authenticate a scan. */
/**
 * How far back liveness evidence is still valid. This MUST exceed the kiosk's challenge
 * duration (CHALLENGE_MS in src/app/kiosk/page.tsx) or a genuine blink that happened in
 * the first second of the challenge is aged out of the window and the user is told "no
 * blink detected" for a blink they actually performed.
 */
export const EVIDENCE_WINDOW_MS = 4500;
/** A blink lasts ~100–400 ms; sampling slower than this cannot be expected to catch one. */
/**
 * Slowest sampling at which a blink is considered observable. A blink lasts ~150 ms, so a
 * median gap much above this means the detector may simply never catch the lids shut — in
 * that case the kiosk asks for a re-scan rather than accusing the user of not blinking.
 */
const BLINK_SAMPLE_MS = 300;

/**
 * Spread of a series, ignoring the most extreme samples at each end. Detector jitter is a
 * one-frame spike; a real head turn, nod or smile persists across many frames. Measuring
 * min→max let a merely noisy photograph accumulate enough apparent "motion" to reach 0.5,
 * so every span below is taken over the 10th–90th percentile instead.
 */
function robustSpan(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.1)];
  const hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.9) - 1)];
  return Math.max(0, hi - lo);
}

export function livenessMetrics(samples: LivenessSample[]): LivenessEvidence {
  const empty: LivenessEvidence = {
    frames: 0,
    blinkObservable: false,
    eyeClosedMs: 0,
    blink: 0,
    yawSpan: 0,
    yawReversal: 0,
    mouthSpan: 0,
    scaleSpan: 0,
    motion: 0,
    minEar: 1,
    maxEar: 1,
  };
  const usable = samples.filter((s) => s.landmarks.length >= 68);
  if (usable.length < 3) return { ...empty, frames: usable.length };

  const last = usable[usable.length - 1].t;
  const window = usable.filter((s) => s.t >= last - EVIDENCE_WINDOW_MS);
  if (window.length < 3) return { ...empty, frames: window.length };

  const ears: number[] = [];
  const yaws: number[] = [];
  const mouths: number[] = [];
  const scales: number[] = [];
  const closedAt: boolean[] = [];

  // pass 1: raw per-frame geometry
  for (const s of window) {
    const l = s.landmarks;
    const leftEye = l.slice(36, 42);
    const rightEye = l.slice(42, 48);
    const ear = (eyeAspect(leftEye) + eyeAspect(rightEye)) / 2;
    ears.push(ear);

    const midX = (l[0].x + l[16].x) / 2;
    const faceW = dist(l[0], l[16]) || 1;
    const faceH = dist(l[27], l[8]) || 1;
    // nose tip (30) relative to the face midline; scale-free
    yaws.push((l[30].x - midX) / faceW);
    // mouth height / face width — leaves the landmark scale out of it
    mouths.push(dist(l[51], l[57]) / faceW);
    // inter-ocular distance / face height: grows when the face approaches the camera
    scales.push(faceW / faceH);
  }

  const n = window.length;
  const gaps: number[] = [];
  for (let i = 1; i < n; i++) gaps.push(window[i].t - window[i - 1].t);
  const medianGap = gaps.length ? [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : 0;
  const spanMs = window[n - 1].t - window[0].t;
  const blinkObservable = n >= 4 && medianGap > 0 && medianGap <= BLINK_SAMPLE_MS && spanMs >= 700;

  const minEar = Math.min(...ears);
  const maxEar = Math.max(...ears);
  const medianEar = [...ears].sort((a, b) => a - b)[Math.floor(n / 2)];
  const nearClosed = Math.min(...ears);
  const openBaseline = Math.max(medianEar, maxEar);

  // a frame counts as "eye closed" when the lid gap collapses by 20%+ versus open
  const closedThreshold = openBaseline * 0.8;
  for (const ear of ears) closedAt.push(ear <= closedThreshold && openBaseline > 0.05);

  let run = 0;
  let bestRun = 0;
  let closedFrames = 0;
  for (let i = 0; i < n; i++) {
    if (closedAt[i]) {
      closedFrames++;
      run++;
      bestRun = Math.max(bestRun, run);
    } else {
      run = 0;
    }
  }
  const eyeClosedMs = bestRun > 1 ? bestRun * (medianGap || 0) : 0;
  // need an open→closed→open transition, i.e. closed frames that are not the edges
  const reopened = closedAt.some((c, i) => !c && i > 0 && closedAt.slice(0, i).some(Boolean));
  const blinkRatio = openBaseline > 0.02 ? nearClosed / openBaseline : 1;
  const blink = blinkObservable && closedFrames > 0 && reopened
    ? Math.max(0, Math.min(1, (1 - blinkRatio - 0.1) / 0.35))
    : 0;

  const yawSpan = robustSpan(yaws);
  // excursion either side of the subject's own mean: a held pose sits on one side only,
  // a real turn goes out and comes back, so the smaller excursion is the honest signal
  const sortedYaw = [...yaws].sort((a, b) => a - b);
  const yawMean = yaws.reduce((a, b) => a + b, 0) / n;
  const yawLo = sortedYaw[Math.floor(n * 0.1)];
  const yawHi = sortedYaw[Math.min(n - 1, Math.ceil(n * 0.9) - 1)];
  const leftExcursion = Math.max(0, yawMean - yawLo);
  const rightExcursion = Math.max(0, yawHi - yawMean);
  const yawReversal = Math.min(leftExcursion, rightExcursion);

  const mouthSpan = robustSpan(mouths);
  const scaleSpan = robustSpan(scales);

  // Bounded micro-motion: any of the three axes moving with real amplitude.
  //
  // These divisors are calibrated against measured landmark noise rather than intuition.
  // A static face under ~4 px of detector jitter still produces apparent spans of
  // ~0.012 (yaw), ~0.025 (scale) and ~0.017 (mouth) — normalising by 0.05/0.06/0.02 read
  // that noise as up to a full unit of motion and let a paper photograph climb towards
  // the threshold. Genuine motion is an order of magnitude larger (a smile is ~0.075 of
  // mouth span, a nod ~0.30 of scale span), so the divisors sit above the noise floor
  // and well below a real gesture.
  const motion = Math.min(1, Math.max(yawSpan / 0.06, scaleSpan / 0.12, mouthSpan / 0.05));

  return {
    frames: n,
    blinkObservable,
    eyeClosedMs: Math.round(eyeClosedMs),
    blink: Math.round(blink * 1000) / 1000,
    yawSpan,
    yawReversal,
    mouthSpan,
    scaleSpan,
    motion,
    minEar,
    maxEar,
  };
}

/**
 * Score a challenge. The challenge must be *passed on its own evidence class*; the
 * remaining budget rewards bounded micro-motion. A frozen photograph scores 0 because
 * every class is exactly zero (tests/test-face-pipeline.mjs pins this).
 */
/**
 * Weight given to passing the mandatory challenge. A still photograph cannot blink, nor
 * turn out and back, so a passed challenge is the strongest available evidence; motion
 * only ever contributes the rest. Calibrated so a noisy photograph tops out at ~0.25
 * while every genuine gesture lands above 0.75.
 */
const CHALLENGE_WEIGHT = 0.75;

export function scoreLiveness(
  samples: LivenessSample[],
  challenge: Challenge,
): { score: number; passed: boolean; detail: Record<string, number | string | boolean>; reason?: string } {
  const m = livenessMetrics(samples);
  let challengeScore = 0;
  let reason: string | undefined;

  if (challenge === "blink") {
    if (!m.blinkObservable) {
      // saying "no blink" here would be a false accusation: the sampling rate, not the
      // person, made the blink unobservable.
      reason = "Hold still — the blink check could not sample your eyes fast enough";
    } else if (m.blink < 0.25) {
      reason = "No blink detected — please blink fully once";
    } else {
      challengeScore = CHALLENGE_WEIGHT;
    }
  } else if (challenge === "turn_left" || challenge === "turn_right") {
    // a real turn reverses by ~0.06; 0.02 left barely more room than detector jitter
    if (m.yawReversal < 0.03) {
      reason = "Turn your head, then come back to centre";
    } else {
      challengeScore = CHALLENGE_WEIGHT;
    }
  } else if (challenge === "smile") {
    // a smile moves mouth span by ~0.075; 0.012 was inside the noise band
    if (m.mouthSpan < 0.03) reason = "Smile a little wider";
    else challengeScore = CHALLENGE_WEIGHT;
  } else if (challenge === "nod") {
    // a real nod changes face width/height by ~0.3; 0.02 was inside the noise band
    if (m.scaleSpan < 0.06) reason = "Nod slowly towards the camera";
    else challengeScore = CHALLENGE_WEIGHT;
  } else {
    if (m.motion < 0.2) reason = "Move your head slightly";
    else challengeScore = CHALLENGE_WEIGHT;
  }

  // Continuous evidence fills the remainder. It is deliberately the minority share:
  // a mandatory challenge is the only signal a photograph cannot reproduce, whereas
  // motion is the weaker one (a photo held by a shaky hand has some).
  const motionScore = m.frames >= 3 ? m.motion * (1 - CHALLENGE_WEIGHT) : 0;
  const score = Math.max(0, Math.min(1, challengeScore + motionScore));
  return {
    score: Math.round(score * 1000) / 1000,
    passed: false, // caller applies the configured threshold
    detail: { ...m, challenge },
    reason,
  };
}

/** Frame quality gate used for both enrolment and recognition. */
export function frameQuality(sample: FaceSample, frameWidth: number, frameHeight: number) {
  const area = (sample.box.width * sample.box.height) / (frameWidth * frameHeight);
  const aspect = sample.box.width / (sample.box.height || 1);
  const centered =
    Math.abs(sample.box.x + sample.box.width / 2 - frameWidth / 2) < frameWidth * 0.22 &&
    Math.abs(sample.box.y + sample.box.height / 2 - frameHeight / 2) < frameHeight * 0.24;
  const sizeOk = area > 0.035;
  const aspectOk = aspect > 0.62 && aspect < 1.45;
  const scoreOk = sample.score > 0.6;
  return {
    ok: sizeOk && aspectOk && scoreOk && centered,
    area,
    aspect,
    centered,
    sizeOk,
    aspectOk,
    scoreOk,
    reasons: [
      !sizeOk ? "Move closer to the camera" : null,
      !centered ? "Centre your face in the frame" : null,
      !aspectOk ? "Face the camera directly" : null,
      !scoreOk ? "Improve the lighting" : null,
    ].filter(Boolean) as string[],
  };
}
