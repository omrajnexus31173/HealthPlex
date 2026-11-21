-- HEALTHPLEX :: 004 trusted server context + notification inserts
--
-- The Next.js route handlers authenticate the caller with their JWT and then use
-- the service-role client for tables the browser must never write directly
-- (students, profiles, kiosk devices, biometric audit). Service-role requests carry
-- no JWT, so `is_admin()` is false inside those statements and the privilege-guard
-- triggers rejected every legitimate administrative write. The guards now accept an
-- explicit trusted server context while ordinary authenticated users remain blocked.

create or replace function public.is_trusted_server() returns boolean
language sql stable as $$
  select coalesce(auth.role(), '') = 'service_role'
      or current_user in ('service_role', 'postgres', 'supabase_admin');
$$;

comment on function public.is_trusted_server() is
  'True when the statement runs from the trusted server context (service role or internal maintenance role).';

create or replace function guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not (is_admin() or is_trusted_server()) then
    raise exception 'Only administrators can change role or account status';
  end if;
  if new.id is distinct from old.id then raise exception 'profile id is immutable'; end if;
  return new;
end $$;

create or replace function guard_student_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_trusted_server()) and (new.enrollment_id is distinct from old.enrollment_id
      or new.department_id is distinct from old.department_id
      or new.academic_year is distinct from old.academic_year
      or new.face_enrolled is distinct from old.face_enrolled
      or new.face_consent is distinct from old.face_consent
      or new.face_consented_at is distinct from old.face_consented_at
      or new.gym_pin_hash is distinct from old.gym_pin_hash
      or new.deleted_at is distinct from old.deleted_at) then
    raise exception 'Field is managed by gym administration';
  end if;
  return new;
end $$;

-- the server writes notifications on a student's behalf (e.g. session cancelled)
create policy notifications_self_insert on notifications
  for insert to authenticated
  with check (user_id = auth.uid());
