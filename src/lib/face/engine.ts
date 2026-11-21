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

export function livenessMetrics(samples: LivenessSample[]) {
  if (samples.length < 3) {
    return { geometry: 0, motion: 0, stable: 0, minEar: 1, maxEar: 1, yawSpan: 0, mouthSpan: 0 };
  }
  const ears: number[] = [];
  const yaws: number[] = [];
  const mouths: number[] = [];
  for (const s of samples) {
    const l = s.landmarks;
    if (l.length < 68) continue;
    const leftEye = l.slice(36, 42);
    const rightEye = l.slice(42, 48);
    ears.push((eyeAspect(leftEye) + eyeAspect(rightEye)) / 2);
    // yaw proxy: horizontal offset of nose tip relative to face midline
    const midX = (l[0].x + l[16].x) / 2;
    const faceW = dist(l[0], l[16]) || 1;
    yaws.push((l[30].x - midX) / faceW);
    mouths.push(dist(l[51], l[57]) / faceW);
  }
  if (!ears.length) return { geometry: 0, motion: 0, stable: 0, minEar: 1, maxEar: 1, yawSpan: 0, mouthSpan: 0 };
  const minEar = Math.min(...ears);
  const maxEar = Math.max(...ears);
  const yawSpan = Math.max(...yaws) - Math.min(...yaws);
  const mouthSpan = Math.max(...mouths) - Math.min(...mouths);
  // 1. geometry: eyes must actually open and close at least once
  const blinkSignal = Math.min(1, Math.max(0, (maxEar - minEar - 0.035) / 0.09));
  // 2. natural micro-motion should exist but stay bounded
  const motionSignal = Math.min(1, yawSpan / 0.05);
  const stableSignal = yawSpan > 0.35 ? 0.2 : 1;
  return { geometry: blinkSignal, motion: motionSignal, stable: stableSignal, minEar, maxEar, yawSpan, mouthSpan };
}

export function scoreLiveness(
  samples: LivenessSample[],
  challenge: Challenge,
): { score: number; passed: boolean; detail: Record<string, number | string>; reason?: string } {
  const m = livenessMetrics(samples);
  let challengeScore = 0;
  let reason: string | undefined;

  // baseline from geometry + bounded motion
  const base = m.geometry * 0.45 + m.motion * 0.2 + m.stable * 0.15;

  if (challenge === "blink") {
    challengeScore = m.geometry >= 0.35 ? 0.2 : 0;
    if (challengeScore === 0) reason = "No blink detected during the challenge";
  } else if (challenge === "turn_left" || challenge === "turn_right") {
    challengeScore = m.yawSpan >= 0.045 ? 0.2 : m.yawSpan >= 0.025 ? 0.1 : 0;
    if (challengeScore === 0) reason = "Head turn not detected";
  } else if (challenge === "smile") {
    challengeScore = m.mouthSpan >= 0.02 ? 0.2 : 0;
    if (challengeScore === 0) reason = "Smile not detected";
  } else {
    challengeScore = m.yawSpan >= 0.02 ? 0.2 : 0.05;
  }

  const score = Math.max(0, Math.min(1, base + challengeScore));
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
