// Mirrors the Postgres enums / tables in supabase/migrations.
export type user_role = "super_admin" | "gym_admin" | "gym_staff" | "trainer" | "student";
export type account_status = "active" | "inactive" | "suspended" | "graduated";
export type attendance_source = "face" | "manual" | "id_fallback" | "import" | "correction";
export type attendance_status = "present" | "checked_out" | "corrected" | "void";
export type attempt_result =
  | "success" | "already_marked" | "cooldown" | "unknown_face" | "low_confidence"
  | "ambiguous_match" | "liveness_failed" | "multiple_faces" | "inactive_student"
  | "no_face" | "no_template" | "error" | "invalid_pin";
export type consent_status = "granted" | "withdrawn";
export type equipment_status = "operational" | "maintenance" | "out_of_service" | "retired";
export type equipment_condition = "excellent" | "good" | "fair" | "poor";
export type maintenance_status = "open" | "in_progress" | "resolved" | "cancelled";
export type session_status = "scheduled" | "cancelled" | "completed";
export type booking_status = "booked" | "cancelled" | "attended" | "no_show";

export type Profile = {
  id: string;
  role: user_role;
  full_name: string;
  email: string;
  phone: string | null;
  avatar_path: string | null;
  status: account_status;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Department = { id: string; name: string; code: string; faculty: string | null };

export type Student = {
  id: string;
  enrollment_id: string;
  department_id: string | null;
  academic_year: number;
  program: string | null;
  photo_path: string | null;
  face_enrolled: boolean;
  face_consent: consent_status;
  face_consented_at: string | null;
  emergency_contact: string | null;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  profile?: Profile;
  department?: Department | null;
};

export type AttendanceRecord = {
  id: string;
  student_id: string;
  attendance_date: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number | null;
  entry_source: attendance_source;
  exit_source: attendance_source | null;
  status: attendance_status;
  is_late: boolean;
  recognition_confidence: number | null;
  liveness_score: number | null;
  correction_reason: string | null;
  corrected_at: string | null;
  marked_by?: string | null;
  profile?: { full_name: string; email: string } | null;
  student?: { enrollment_id: string; photo_path?: string | null } | null;
};

export type GymSettings = {
  id: boolean;
  gym_name: string;
  timezone: string;
  capacity: number;
  cooldown_minutes: number;
  entry_exit_enabled: boolean;
  recognition_threshold: number;
  recognition_margin: number;
  liveness_threshold: number;
  booking_enabled: boolean;
  opening_hours: Record<string, string>;
  capacity_alerts: boolean;
  min_presence_minutes: number;
  retention_months: number;
  retention_enabled: boolean;
  retention_armed: boolean;
  retention_approved_by: string | null;
  retention_approved_at: string | null;
  updated_at: string;
};

export type Equipment = {
  id: string;
  tag_code: string;
  name: string;
  category: string;
  brand: string | null;
  location: string | null;
  purchased_on: string | null;
  condition: equipment_condition;
  status: equipment_status;
  last_serviced_on: string | null;
  next_service_on: string | null;
  notes: string | null;
  created_at: string;
};

export type MaintenanceRecord = {
  id: string;
  equipment_id: string;
  type: "fault" | "preventive" | "inspection";
  status: maintenance_status;
  title: string;
  description: string | null;
  reported_at: string;
  resolved_at: string | null;
  resolution_notes: string | null;
  equipment?: { name: string; tag_code: string } | null;
  reporter?: { full_name: string } | null;
};

export type TrainingSession = {
  id: string;
  title: string;
  description: string | null;
  trainer_id: string | null;
  session_date: string;
  start_time: string;
  end_time: string;
  capacity: number;
  location: string | null;
  status: session_status;
  booking_enabled: boolean;
  trainer?: { profile?: { full_name: string } | null } | null;
  booked?: number;
};

export type TrainerProfile = {
  id: string;
  trainer_code: string;
  specialization: string | null;
  experience_years: number | null;
  bio: string | null;
  availability: string | null;
  profile?: Profile;
};

export type StaffProfile = {
  id: string;
  staff_code: string;
  designation: string | null;
  shift_id: string | null;
  joined_on: string | null;
  profile?: Profile;
};

export type Notification = {
  id: string;
  user_id: string | null;
  role: user_role | null;
  title: string;
  body: string | null;
  severity: "info" | "success" | "warning" | "critical";
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type DashboardStats = {
  total_students: number;
  active_students: number;
  face_enrolled: number;
  today_visits: number;
  today_unique: number;
  currently_inside: number;
  capacity: number;
  this_month_visits: number;
  last_month_visits: number;
  open_faults: number;
  equipment_total: number;
  equipment_down: number;
  upcoming_sessions: number;
  unverified_attempts: number;
  attendance_rate: number;
};

export type CleanupRun = {
  id: string;
  mode: "dry_run" | "execute";
  status: "running" | "success" | "failed" | "aborted";
  started_at: string;
  finished_at: string | null;
  cutoff_date: string | null;
  candidate_records: number | null;
  archived_students: number | null;
  archived_departments: number | null;
  archived_hours: number | null;
  deleted_records: number | null;
  backup_id: string | null;
  triggered_by: string;
  error: string | null;
  details: Record<string, unknown> | null;
};

export type RetentionStatus = {
  retention_months: number;
  enabled: boolean;
  armed: boolean;
  approved_by: string | null;
  approved_at: string | null;
  cutoff_date: string;
  candidate_records: number;
  total_attendance_records: number;
  oldest_record: string | null;
  newest_record: string | null;
  last_execute: CleanupRun | null;
  next_scheduled: string;
  db_size_bytes: number;
  attendance_table_bytes: number;
  backups_total_bytes: number;
  backups_count: number;
};
