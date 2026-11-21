"use client";

import { createClient } from "@/lib/supabase/client";
import { base64ToDescriptor, DESCRIPTOR_VERSION, type Challenge } from "./engine";
import type { EnrolledTemplate } from "./recognition";

const STORAGE_KEY = "healthplex.kiosk.device";

export type KioskDeviceSession = { code: string; name: string; location: string | null; linkedAt: string };

export function getStoredKiosk(): KioskDeviceSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as KioskDeviceSession;
    return parsed?.code ? parsed : null;
  } catch {
    return null;
  }
}

export function storeKiosk(session: KioskDeviceSession) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearKiosk() {
  localStorage.removeItem(STORAGE_KEY);
}

export type KioskStudentRow = {
  student_id: string;
  full_name: string;
  enrollment_id: string;
  photo_path: string | null;
  account_status: string;
  has_template: boolean;
};

export type TemplateBundle = {
  students: KioskStudentRow[];
  templates: EnrolledTemplate[];
  config: {
    recognition_threshold: number;
    recognition_margin: number;
    liveness_threshold: number;
    cooldown_minutes: number;
    entry_exit_enabled: boolean;
    capacity: number;
    timezone: string;
    gym_name: string;
  };
  server_time: string;
  signed_photo_urls: Record<string, string>;
};

async function token() {
  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Your staff session expired. Sign in again.");
  return session.access_token;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await token()}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload as T;
}

/** Pair this physical kiosk with a device key issued by an administrator. */
export async function linkKiosk(code: string) {
  const payload = await post<{ ok: true; name: string; location: string | null }>("/api/kiosk/link", { code: code.trim() });
  storeKiosk({ code: code.trim(), name: payload.name, location: payload.location, linkedAt: new Date().toISOString() });
  return payload;
}

export async function fetchTemplates(code: string): Promise<TemplateBundle> {
  const raw = await post<{
    students: KioskStudentRow[];
    templates: { student_id: string; descriptor: string; version: string }[];
    config: TemplateBundle["config"];
    server_time: string;
    signed_photo_urls: Record<string, string>;
  }>("/api/kiosk/templates", { code });

  const templates: EnrolledTemplate[] = raw.templates
    .filter((t) => t.version === DESCRIPTOR_VERSION)
    .map((t) => ({ student_id: t.student_id, descriptor: base64ToDescriptor(t.descriptor), version: t.version }));

  return { ...raw, templates };
}

export type ScanResponse = {
  status: "success" | "duplicate" | "cooldown" | "unknown" | "inactive" | "error";
  action?: "entry" | "exit";
  message: string;
  student?: { id: string; name: string; enrollment: string; photo_path: string | null; department_id?: string | null };
  record?: {
    id: string;
    check_in_at: string;
    check_out_at: string | null;
    duration_minutes: number | null;
    attendance_date: string;
  };
  server_time?: string;
  inside_count?: number;
  capacity?: number;
};

export function submitScan(input: {
  code: string;
  studentId: string;
  confidence: number;
  liveness: number;
  faces: number;
  meta?: Record<string, unknown>;
}) {
  return post<ScanResponse>("/api/kiosk/scan", {
    code: input.code,
    student_id: input.studentId,
    confidence: input.confidence,
    liveness_score: input.liveness,
    faces_detected: input.faces,
    meta: input.meta ?? {},
  });
}

export function logAttempt(input: {
  code: string;
  studentId?: string | null;
  result: string;
  confidence?: number;
  secondBest?: number;
  liveness?: number;
  faces?: number;
  reason?: string;
  meta?: Record<string, unknown>;
}) {
  return post<{ ok: true }>("/api/kiosk/attempt", {
    code: input.code,
    student_id: input.studentId ?? null,
    result: input.result,
    confidence: input.confidence,
    second_best: input.secondBest,
    liveness_score: input.liveness,
    faces_detected: input.faces,
    reason: input.reason,
    meta: input.meta ?? {},
  });
}

export type ChallengeResult = { challenge: Challenge; score: number; passed: boolean; detail: Record<string, unknown> };
