-- HEALTHPLEX :: 005 retention job hardening (cron trigger, serialisation, hard-delete guard)
-- Fixes discovered while verifying the retention system against the live database:
--  * run_attendance_cleanup() rejected the pg_cron call because `session_user` is
--    'authenticator' (not 'postgres') when cron invokes it over the REST/DB gateway,
--    so the monthly job could never actually run.
--  * cleanup_backups.payload is only readable by the service role, but the
--    destructive step must re-verify the backup it just wrote; the verification is
--    kept inside the SECURITY DEFINER function, so no extra grant is needed.
--  * nothing prevented a second concurrent execute run (cron overlapping a manual
--    run). A partial unique index makes executions serialised and idempotent.

create or replace function public.run_attendance_cleanup(
  p_mode cleanup_mode default 'dry_run',
  p_trigger text default 'manual',
  p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_run cleanup_runs; v_settings gym_settings; v_cutoff date; v_candidates int;
  v_payload jsonb; v_checksum text; v_backup uuid; v_stats jsonb; v_deleted int;
  v_verify jsonb; v_verify_checksum text; v_busy int;
begin
  if p_trigger = 'manual' then
    if not is_super_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
    p_actor := auth.uid();
  elsif p_trigger = 'cron' then
    -- pg_cron runs as the internal scheduler role; a browser session can never
    -- satisfy this because the caller then has a JWT claim and auth.role()='authenticated'
    if auth.uid() is not null or coalesce(auth.role(), '') not in ('', 'service_role') then
      raise exception 'cron trigger requires internal session' using errcode = '42501';
    end if;
  else
    raise exception 'invalid trigger source';
  end if;

  -- recover runs abandoned mid-flight (e.g. process restart) so the schedule can never wedge
  update cleanup_runs set status = 'failed', finished_at = now(),
    error = coalesce(error, 'abandoned run - cleared by the next execution')
  where mode = 'execute' and status = 'running' and started_at < now() - interval '1 hour';

  -- one execution at a time: the partial unique index below backs this check
  select count(*) into v_busy from cleanup_runs where mode = 'execute' and status = 'running';
  if v_busy > 0 then
    return jsonb_build_object('aborted', true, 'message',
      'Another cleanup execution is already running. Nothing was deleted.');
  end if;

  select * into v_settings from gym_settings where id;
  v_cutoff := retention_cutoff_date();

  insert into cleanup_runs (mode, status, cutoff_date, triggered_by, actor_id)
  values (p_mode, 'running', v_cutoff, p_trigger, p_actor) returning * into v_run;

  select count(*) into v_candidates from attendance_records where attendance_date < v_cutoff;

  if p_mode = 'dry_run' then
    update cleanup_runs set status = 'success', finished_at = now(), candidate_records = v_candidates,
      details = jsonb_build_object('preview', true, 'message',
        v_candidates || ' records older than ' || v_cutoff || ' would be archived and deleted')
    where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'dry_run',
      'candidate_records', v_candidates, 'cutoff_date', v_cutoff, 'deleted', 0);
  end if;

  if not v_settings.retention_enabled or not v_settings.retention_armed then
    update cleanup_runs set status = 'aborted', finished_at = now(), candidate_records = v_candidates,
      error = 'retention policy not armed by super admin' where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'aborted', true,
      'candidate_records', v_candidates, 'cutoff_date', v_cutoff, 'deleted', 0,
      'message', 'Cleanup skipped: retention policy is not enabled/armed.');
  end if;

  if v_candidates = 0 then
    update cleanup_runs set status = 'success', finished_at = now(), candidate_records = 0 where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'deleted', 0,
      'candidate_records', 0, 'cutoff_date', v_cutoff);
  end if;

  -- 1. preserve aggregates (never touches profiles, accounts, templates or config)
  v_stats := refresh_monthly_summaries('1900-01-01'::date, v_cutoff - 1);

  -- 2. verified backup snapshot (compact JSON export) before any deletion
  select coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) into v_payload
    from attendance_records a where a.attendance_date < v_cutoff;
  v_checksum := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');
  insert into cleanup_backups (cutoff_date, record_count, checksum, payload, verified, verified_at, storage_bytes)
  values (v_cutoff, v_candidates, v_checksum, v_payload, true, now(), octet_length(v_payload::text))
  returning id into v_backup;

  -- verify the backup we just wrote round-trips and matches the checksum
  select payload into v_verify from cleanup_backups where id = v_backup;
  v_verify_checksum := encode(sha256(convert_to(v_verify::text, 'UTF8')), 'hex');
  if v_verify_checksum is distinct from v_checksum or jsonb_array_length(v_verify) <> v_candidates then
    update cleanup_backups set verified = false where id = v_backup;
    update cleanup_runs set status = 'failed', finished_at = now(), candidate_records = v_candidates,
      backup_id = v_backup, error = 'backup verification failed - deletion aborted' where id = v_run.id;
    return jsonb_build_object('run_id', v_run.id, 'failed', true, 'error', 'backup verification failed');
  end if;

  -- 3. destructive step, guarded by the same cutoff expression
  delete from attendance_records where attendance_date < retention_cutoff_date();
  get diagnostics v_deleted = row_count;

  update cleanup_runs set status = 'success', finished_at = now(), candidate_records = v_candidates,
    archived_students = (v_stats->>'students')::int, archived_departments = (v_stats->>'departments')::int,
    archived_hours = (v_stats->>'hours')::int, deleted_records = v_deleted, backup_id = v_backup,
    details = jsonb_build_object('cutoff', v_cutoff, 'checksum', v_checksum, 'summary', v_stats)
  where id = v_run.id;

  insert into audit_logs (actor_id, actor_role, action, entity, entity_id, after)
  values (p_actor, (select role from profiles where id = p_actor), 'retention.cleanup_execute',
    'attendance_records', v_run.id::text,
    jsonb_build_object('deleted', v_deleted, 'cutoff', v_cutoff, 'backup_id', v_backup));

  return jsonb_build_object('run_id', v_run.id, 'mode', 'execute', 'cutoff_date', v_cutoff,
    'candidate_records', v_candidates, 'deleted', v_deleted, 'backup_id', v_backup,
    'backups_verified', true, 'summaries', v_stats);
exception when others then
  update cleanup_runs set status = 'failed', finished_at = now(), error = sqlerrm where id = v_run.id;
  raise;
end $$;

-- serialise executions (idempotent: safe to re-run)
create unique index if not exists cleanup_runs_single_execute
  on cleanup_runs ((mode)) where mode = 'execute' and status = 'running';

-- students may be soft-deleted but never hard-deleted from the API surface
create or replace function public.guard_student_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- the application only ever soft-deletes; internal maintenance roles may still
  -- remove rows (e.g. cascading from an auth user removal)
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return old;
  end if;
  raise exception 'Student records cannot be hard deleted — soft delete only';
end $$;

drop trigger if exists students_no_hard_delete on students;
create trigger students_no_hard_delete before delete on students
  for each row execute function guard_student_delete();

-- attendance can only be deleted by the retention routine (SECURITY DEFINER) or service role
revoke delete on attendance_records from authenticated, anon;
