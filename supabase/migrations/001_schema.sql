-- HEALTHPLEX :: 001 core schema
-- Dedicated Supabase project: healthplex (shxtfzrbkutbwtkwilaq)
-- No membership / subscription / payment tables by design.

create type user_role as enum ('super_admin','gym_admin','gym_staff','trainer','student');
create type account_status as enum ('active','inactive','suspended','graduated');
create type attendance_source as enum ('face','manual','id_fallback','import','correction');
create type attendance_status as enum ('present','checked_out','corrected','void');
create type attempt_result as enum ('success','already_marked','cooldown','unknown_face','low_confidence','ambiguous_match','liveness_failed','multiple_faces','inactive_student','no_face','no_template','error','invalid_pin');
create type consent_status as enum ('granted','withdrawn');
create type equipment_status as enum ('operational','maintenance','out_of_service','retired');
create type equipment_condition as enum ('excellent','good','fair','poor');
create type maintenance_type as enum ('fault','preventive','inspection');
create type maintenance_status as enum ('open','in_progress','resolved','cancelled');
create type session_status as enum ('scheduled','cancelled','completed');
create type booking_status as enum ('booked','cancelled','attended','no_show');
create type notification_severity as enum ('info','success','warning','critical');
create type cleanup_mode as enum ('dry_run','execute');

-- ============ departments ============
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text not null unique,
  faculty text,
  created_at timestamptz not null default now()
);

-- ============ profiles (identity for every role) ============
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role user_role not null default 'student',
  full_name text not null,
  email text not null,
  phone text,
  avatar_path text,
  status account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on profiles (lower(email));
create index profiles_role_idx on profiles (role);

-- ============ students ============
create table students (
  id uuid primary key references profiles(id) on delete cascade,
  enrollment_id text not null,
  department_id uuid references departments(id),
  academic_year smallint not null default 1 check (academic_year between 1 and 6),
  program text,
  photo_path text,
  face_enrolled boolean not null default false,
  face_consent consent_status not null default 'withdrawn',
  face_consented_at timestamptz,
  gym_pin_hash text,
  emergency_contact text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index students_enrollment_id_key on students (upper(enrollment_id));
create index students_department_idx on students (department_id);
alter table students add column deleted_at timestamptz;

-- ============ staff / trainers ============
create table staff (
  id uuid primary key references profiles(id) on delete cascade,
  staff_code text not null unique,
  designation text,
  shift_id uuid,
  joined_on date default current_date,
  notes text,
  created_at timestamptz not null default now()
);

create table trainers (
  id uuid primary key references profiles(id) on delete cascade,
  trainer_code text not null unique,
  specialization text,
  experience_years smallint default 0,
  bio text,
  availability text,
  created_at timestamptz not null default now()
);

create table gym_shifts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_time time not null,
  end_time time not null,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table staff add constraint staff_shift_fk foreign key (shift_id) references gym_shifts(id) on delete set null;

create table trainer_schedules (
  id uuid primary key default gen_random_uuid(),
  trainer_id uuid not null references trainers(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  focus text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);
create index trainer_schedules_trainer_idx on trainer_schedules (trainer_id, weekday);

-- ============ gym settings (single row) ============
create table gym_settings (
  id boolean primary key default true check (id),
  gym_name text not null default 'HEALTHPLEX — GSFC University Gym',
  timezone text not null default 'Asia/Kolkata',
  capacity integer not null default 80 check (capacity > 0),
  cooldown_minutes integer not null default 5 check (cooldown_minutes between 0 and 240),
  entry_exit_enabled boolean not null default true,
  recognition_threshold numeric(4,3) not null default 0.48,
  recognition_margin numeric(4,3) not null default 0.06,
  liveness_threshold numeric(4,3) not null default 0.60,
  booking_enabled boolean not null default true,
  opening_hours jsonb not null default '{"mon":"06:00-21:00","tue":"06:00-21:00","wed":"06:00-21:00","thu":"06:00-21:00","fri":"06:00-21:00","sat":"07:00-19:00","sun":"closed"}'::jsonb,
  capacity_alerts boolean not null default true,
  retention_months smallint not null default 6 check (retention_months between 1 and 60),
  retention_enabled boolean not null default false,
  retention_armed boolean not null default false,
  retention_approved_by text,
  retention_approved_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ============ kiosk devices ============
create table kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  location text,
  code_hash text not null unique,
  status text not null default 'active' check (status in ('active','revoked')),
  last_seen_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ============ biometric templates (server-only, encrypted at rest) ============
create table face_templates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null unique references students(id) on delete cascade,
  ciphertext bytea not null,
  iv bytea not null,
  auth_tag bytea not null,
  key_version smallint not null default 1,
  descriptor_version text not null default 'face-api-1.7.15/128d/fp32',
  dimension smallint not null default 128,
  samples_count smallint not null default 0,
  quality numeric(5,4),
  liveness_score numeric(5,4),
  consent_version text not null default 'v1-2026-11',
  consented_at timestamptz not null,
  status consent_status not null default 'granted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table face_enrollment_audit (
  id bigserial primary key,
  student_id uuid references students(id) on delete cascade,
  action text not null check (action in ('enrolled','re_enrolled','withdrawn','verification_failed')),
  actor_id uuid references profiles(id),
  actor_role user_role,
  samples_count smallint,
  liveness_score numeric(5,4),
  quality numeric(5,4),
  notes text,
  created_at timestamptz not null default now()
);
create index face_audit_student_idx on face_enrollment_audit (student_id, created_at desc);

-- ============ attendance ============
create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references students(id) on delete cascade,
  attendance_date date not null,
  check_in_at timestamptz not null default now(),
  check_out_at timestamptz,
  duration_minutes integer,
  entry_source attendance_source not null default 'face',
  exit_source attendance_source,
  status attendance_status not null default 'present',
  is_late boolean not null default false,
  device_id uuid references kiosk_devices(id),
  recognition_confidence numeric(5,4),
  liveness_score numeric(5,4),
  marked_by uuid references profiles(id),
  correction_reason text,
  corrected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index attendance_student_checkin_key on attendance_records (student_id, check_in_at);
create index attendance_date_idx on attendance_records (attendance_date desc);
create index attendance_student_date_idx on attendance_records (student_id, attendance_date desc);
create index attendance_open_idx on attendance_records (check_out_at) where check_out_at is null;
create index attendance_checkin_idx on attendance_records (check_in_at desc);

create table attendance_attempts (
  id bigserial primary key,
  attempted_at timestamptz not null default now(),
  student_id uuid references students(id) on delete set null,
  device_id uuid references kiosk_devices(id),
  result attempt_result not null,
  confidence numeric(5,4),
  second_best numeric(5,4),
  liveness_score numeric(5,4),
  faces_detected smallint,
  reason text,
  meta jsonb,
  reviewed boolean not null default false,
  reviewed_by uuid references profiles(id)
);
create index attempts_time_idx on attendance_attempts (attempted_at desc);
create index attempts_result_idx on attendance_attempts (result, attempted_at desc);

-- ============ equipment ============
create table equipment (
  id uuid primary key default gen_random_uuid(),
  tag_code text not null unique,
  name text not null,
  category text not null default 'general',
  brand text,
  location text,
  purchased_on date,
  condition equipment_condition not null default 'good',
  status equipment_status not null default 'operational',
  last_serviced_on date,
  next_service_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index equipment_status_idx on equipment (status);

create table equipment_maintenance (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references equipment(id) on delete cascade,
  type maintenance_type not null default 'fault',
  status maintenance_status not null default 'open',
  title text not null,
  description text,
  reported_by uuid references profiles(id),
  reported_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id),
  resolution_notes text
);
create index maintenance_equipment_idx on equipment_maintenance (equipment_id, reported_at desc);
create index maintenance_open_idx on equipment_maintenance (status) where status in ('open','in_progress');

-- ============ sessions & bookings ============
create table training_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  trainer_id uuid references trainers(id) on delete set null,
  session_date date not null,
  start_time time not null,
  end_time time not null,
  capacity smallint not null default 20 check (capacity > 0),
  location text default 'Main Gym Floor',
  status session_status not null default 'scheduled',
  booking_enabled boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);
create index sessions_date_idx on training_sessions (session_date, start_time);

create table session_bookings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references training_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  status booking_status not null default 'booked',
  booked_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (session_id, student_id)
);
create index bookings_student_idx on session_bookings (student_id, booked_at desc);

create table session_attendance (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references training_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  marked_at timestamptz not null default now(),
  marked_by uuid references profiles(id),
  status text not null default 'present' check (status in ('present','absent')),
  unique (session_id, student_id)
);

-- ============ notifications ============
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  role user_role,
  title text not null,
  body text,
  severity notification_severity not null default 'info',
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on notifications (user_id, created_at desc);
create index notifications_role_idx on notifications (role, created_at desc);

-- ============ audit ============
create table audit_logs (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  actor_role user_role,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_created_idx on audit_logs (created_at desc);
create index audit_actor_idx on audit_logs (actor_id, created_at desc);

-- ============ retention / cleanup ============
create table attendance_monthly_summary (
  year smallint not null,
  month smallint not null check (month between 1 and 12),
  total_visits integer not null default 0,
  unique_students integer not null default 0,
  total_minutes bigint not null default 0,
  avg_duration_minutes numeric(6,1),
  peak_hour smallint,
  computed_at timestamptz not null default now(),
  primary key (year, month)
);

create table attendance_monthly_student_summary (
  student_id uuid not null references students(id) on delete cascade,
  year smallint not null,
  month smallint not null,
  department_id uuid references departments(id) on delete set null,
  visits integer not null default 0,
  total_minutes bigint not null default 0,
  first_visit timestamptz,
  last_visit timestamptz,
  primary key (student_id, year, month)
);

create table attendance_monthly_department_summary (
  department_id uuid references departments(id) on delete cascade,
  year smallint not null,
  month smallint not null,
  visits integer not null default 0,
  unique_students integer not null default 0,
  primary key (department_id, year, month)
);

create table attendance_monthly_hourly_summary (
  year smallint not null,
  month smallint not null,
  hour smallint not null check (hour between 0 and 23),
  visits integer not null default 0,
  primary key (year, month, hour)
);

create table cleanup_backups (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  cutoff_date date not null,
  record_count integer not null,
  checksum text not null,
  payload jsonb not null,
  verified boolean not null default false,
  verified_at timestamptz,
  storage_bytes bigint
);

create table cleanup_runs (
  id uuid primary key default gen_random_uuid(),
  mode cleanup_mode not null default 'dry_run',
  status text not null default 'running' check (status in ('running','success','failed','aborted')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cutoff_date date,
  candidate_records integer default 0,
  archived_students integer default 0,
  archived_departments integer default 0,
  archived_hours integer default 0,
  deleted_records integer default 0,
  backup_id uuid references cleanup_backups(id),
  triggered_by text not null default 'cron',
  actor_id uuid references profiles(id),
  error text,
  details jsonb
);
create index cleanup_runs_started_idx on cleanup_runs (started_at desc);

create table retention_settings_audit (
  id bigserial primary key,
  actor_id uuid references profiles(id),
  action text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ============ updated_at triggers ============
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger profiles_touch before update on profiles for each row execute function set_updated_at();
create trigger students_touch before update on students for each row execute function set_updated_at();
create trigger attendance_touch before update on attendance_records for each row execute function set_updated_at();
create trigger equipment_touch before update on equipment for each row execute function set_updated_at();
create trigger face_templates_touch before update on face_templates for each row execute function set_updated_at();
create trigger gym_settings_touch before update on gym_settings for each row execute function set_updated_at();
