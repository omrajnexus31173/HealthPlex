-- HEALTHPLEX :: 009 kiosk_students() was declared STABLE but performs an UPDATE
--
-- kiosk_students() touches kiosk_devices.last_seen_at before returning the roster,
-- which PostgreSQL forbids inside a STABLE function ("UPDATE is not allowed in a
-- non-volatile function"), so every kiosk roster fetch failed at runtime. It is now
-- VOLATILE and keeps the same device-key guard.

create or replace function public.kiosk_students(p_code text)
returns table (student_id uuid, full_name text, enrollment_id text, photo_path text,
               account_status account_status, face_enrolled boolean, has_template boolean)
language plpgsql volatile security definer set search_path = public as $$
declare v_device uuid;
begin
  select id into v_device from kiosk_devices
   where code_hash = encode(sha256(convert_to(p_code, 'UTF8')), 'hex') and status = 'active';
  if v_device is null then
    raise exception 'KIOSK_UNAUTHORIZED' using errcode = '28000';
  end if;
  update kiosk_devices set last_seen_at = now() where id = v_device;
  return query
    select s.id, p.full_name, s.enrollment_id, s.photo_path, p.status, s.face_enrolled,
           exists (select 1 from face_templates ft where ft.student_id = s.id and ft.status = 'granted')
      from students s
      join profiles p on p.id = s.id
     where s.deleted_at is null
       and exists (select 1 from face_templates ft where ft.student_id = s.id and ft.status = 'granted')
     order by p.full_name;
end $$;

revoke execute on function public.kiosk_students(text) from public, anon;
grant execute on function public.kiosk_students(text) to authenticated, service_role;
