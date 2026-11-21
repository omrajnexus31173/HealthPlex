import { NextResponse, type NextRequest } from "next/server";
import { authenticate, audit, isResponse, jsonError, requireRole } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StudentPayload = {
  full_name: string;
  email: string;
  enrollment_id: string;
  department_id: string | null;
  academic_year: number;
  program?: string | null;
  phone?: string | null;
  emergency_contact?: string | null;
  status?: "active" | "inactive" | "suspended" | "graduated";
  password?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateStudent(input: Partial<StudentPayload>) {
  const errors: string[] = [];
  if (!input.full_name || input.full_name.trim().length < 3) errors.push("Full name must be at least 3 characters");
  if (!input.email || !EMAIL_RE.test(input.email)) errors.push("A valid university email is required");
  if (!input.enrollment_id || input.enrollment_id.trim().length < 3) errors.push("University enrollment ID is required");
  const year = Number(input.academic_year);
  if (!Number.isInteger(year) || year < 1 || year > 6) errors.push("Academic year must be between 1 and 6");
  return errors;
}

export async function POST(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin"]);
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as StudentPayload;
  const errors = validateStudent(body);
  if (errors.length) return jsonError(errors.join(" · "));

  const email = body.email.trim().toLowerCase();
  const enrollment = body.enrollment_id.trim().toUpperCase();
  const password = body.password && body.password.length >= 8 ? body.password : `Hp!${crypto.randomUUID().slice(0, 8)}A1`;
  const service = createServiceSupabase();

  // duplicate prevention — enrollment id and email are both unique at DB level
  const [{ data: dupEnroll }, { data: dupEmail }] = await Promise.all([
    service.from("students").select("id, enrollment_id").ilike("enrollment_id", enrollment).maybeSingle(),
    service.from("profiles").select("id, email").ilike("email", email).maybeSingle(),
  ]);
  if (dupEnroll) return jsonError(`Enrollment ID ${enrollment} is already registered`, 409);
  if (dupEmail) return jsonError("A user with this email already exists", 409);

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: body.full_name.trim(), enrollment_id: enrollment },
  });
  if (createError || !created.user) return jsonError(createError?.message ?? "Could not create the account", 400);

  const userId = created.user.id;
  const { error: profileError } = await service.from("profiles").insert({
    id: userId,
    role: "student",
    full_name: body.full_name.trim(),
    email,
    phone: body.phone?.trim() || null,
    status: body.status ?? "active",
    must_change_password: true,
  });
  if (profileError) {
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return jsonError(profileError.message, 400);
  }

  const { error: studentError } = await service.from("students").insert({
    id: userId,
    enrollment_id: enrollment,
    department_id: body.department_id || null,
    academic_year: Number(body.academic_year),
    program: body.program?.trim() || null,
    emergency_contact: body.emergency_contact?.trim() || null,
  });
  if (studentError) {
    await service.auth.admin.deleteUser(userId).catch(() => undefined);
    return jsonError(studentError.message, 400);
  }

  await audit(ctx, "student.create", "students", userId, null, { enrollment_id: enrollment, email });
  return NextResponse.json({ id: userId, temporary_password: password, enrollment_id: enrollment });
}

export async function GET(request: NextRequest) {
  const ctx = await authenticate(request);
  if (isResponse(ctx)) return ctx;
  const denied = requireRole(ctx, ["super_admin", "gym_admin", "gym_staff"]);
  if (denied) return denied;
  const service = createServiceSupabase();
  const { data, error } = await service
    .from("students")
    .select("id, enrollment_id, academic_year, program, photo_path, face_enrolled, face_consent, department_id, profiles:profiles(full_name,email,phone,status), departments(name,code)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ students: data });
}
