"use client";

import { detectFaces, matchDescriptors, type FaceSample } from "./engine";
import type { Match } from "./engine";

/**
 * Kiosk recognition pipeline.
 *
 * Identity matching is performed in the browser against templates that the
 * server hands to this device for this session only (device-key authenticated).
 * Templates are decrypted server-side — the browser never sees the data key,
 * and the decrypted descriptors live only in memory.
 *
 * A match is only accepted when:
 *   1. exactly ONE face is present (never guess between multiple people)
 *   2. best distance <= threshold (default 0.48) AND
 *   3. the margin over the second-best candidate >= configured margin
 */

export type EnrolledTemplate = { student_id: string; descriptor: Float32Array; version: string };

export type ScanOutcome =
  | { kind: "no_face" }
  | { kind: "multiple_faces"; count: number }
  | { kind: "unknown"; confidence: number; best?: number }
  | { kind: "ambiguous"; confidence: number; second: number }
  | { kind: "match"; studentId: string; confidence: number; distance: number; second?: number; faces: number; sample: FaceSample };

export type RecognitionConfig = { threshold: number; margin: number };

export function identify(
  samples: FaceSample[],
  templates: EnrolledTemplate[],
  cfg: RecognitionConfig,
): ScanOutcome {
  if (samples.length === 0) return { kind: "no_face" };
  if (samples.length > 1) return { kind: "multiple_faces", count: samples.length };

  const sample = samples[0];
  if (templates.length === 0) return { kind: "unknown", confidence: 0 };

  const { best, second } = matchDescriptors(
    sample.descriptor,
    templates.map((t, index) => ({ index, descriptor: t.descriptor })),
  );
  if (!best) return { kind: "unknown", confidence: 0 };

  const bestStudent = templates[best.index].student_id;
  const confidence = Math.round(best.confidence * 10000) / 10000;
  const secondStudent = second ? templates[second.index].student_id : null;
  const secondConfidence = second ? Math.round(second.confidence * 10000) / 10000 : 0;

  if (best.distance > cfg.threshold) {
    return { kind: "unknown", confidence, best: confidence };
  }
  if (second && secondStudent !== bestStudent && best.confidence - second.confidence < cfg.margin) {
    return { kind: "ambiguous", confidence, second: secondConfidence };
  }
  return {
    kind: "match",
    studentId: bestStudent,
    confidence,
    distance: Math.round(best.distance * 10000) / 10000,
    second: secondConfidence,
    faces: samples.length,
    sample,
  };
}

export async function scanFrame(
  video: HTMLVideoElement,
  templates: EnrolledTemplate[],
  cfg: RecognitionConfig,
): Promise<{ outcome: ScanOutcome; samples: FaceSample[] }> {
  const samples = await detectFaces(video);
  return { outcome: identify(samples, templates, cfg), samples };
}
