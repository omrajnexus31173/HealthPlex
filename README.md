# HEALTHPLEX

Gym management for GSFC University: student records, face-recognition attendance at a
paired kiosk, live occupancy monitoring, analytics, equipment and session booking,
audit logging, and a 6-month data-retention subsystem with checksum-verified backups.

- **Deployed**: https://healthplex.vercel.app
- **Readiness statement**: [`docs/PRODUCTION-READINESS.md`](docs/PRODUCTION-READINESS.md) — exactly what is and is not verified.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, Turbopack), React 19, Tailwind 4, TypeScript |
| Data / auth | Supabase Postgres + GoTrue, RLS on every table, `@supabase/ssr` cookie sessions |
| Face recognition | `@vladmandic/face-api` (tinyFaceDetector + 68 landmarks + 128-D recogniser), models vendored in `public/models` |
| Templates | AES-256-GCM envelope encryption, server-side key only |
| Scheduling | `pg_cron` for monthly retention, Vercel cron for the health guard |

## Roles

`super_admin` → `gym_admin` → `gym_staff` → `trainer` → `student`. Navigation and page
access are derived from the role (`src/lib/roles.ts`); the database enforces the same
boundaries with RLS and guard triggers, so a UI mistake cannot widen access.

| Role | Sees |
| --- | --- |
| super_admin | everything, including `/retention` and `/security/audit` |
| gym_admin | students, staff, sessions, equipment, kiosks, settings, audit |
| gym_staff | dashboard, students, attendance, analytics, monitor, sessions, equipment |
| trainer | dashboard, students (read), attendance, analytics, monitor, sessions |
| student | own dashboard, attendance history, profile, face enrolment consent |

## Layout

```
src/app/(staff)/…          staff surfaces (dashboard, students, attendance, analytics,
                           monitor, staff, sessions, equipment, retention, settings,
                           security/kiosks, security/audit)
src/app/me/…               student self-service
src/app/kiosk/             the kiosk terminal UI
src/app/api/kiosk/…        roster, scan, pairing, attempts (device-key authenticated)
src/app/api/admin/…        student/staff/face administration (session authenticated)
src/app/api/me/…           student self-service actions (consent withdrawal)
src/lib/server/            auth helpers, template crypto, audit/notify
supabase/migrations/       001 schema → 011 template integrity
scripts/                   test-face-pipeline.mjs, test-security-semantics.mjs
```

## Attendance flow

1. The kiosk loads its roster with `kiosk_students(deviceKey)`, which also refreshes
   `last_seen_at`.
2. In the browser it matches a face against decrypted templates it does not hold — the
   descriptors stay server-side; the kiosk only receives student ids.
3. On a match it posts confidence, liveness and face count to `/api/kiosk/scan`, which
   re-checks the device key, the confidence threshold and the liveness threshold before
   calling `kiosk_scan`.
4. `kiosk_scan` decides entry vs exit, enforces the re-entry cooldown, writes the record
   and the attempt log, and returns occupancy.

Server-side re-validation is the trust boundary: a tampered client cannot bypass the
thresholds, and an unpaired device cannot mark attendance at all.

## Data retention

Retention is **disarmed by default**. A super administrator arms it from `/retention`
(months, enable, arm, execute). When the `pg_cron` job or an operator runs it:

1. it refuses unless the policy is armed (an unarmed run is logged `aborted`);
2. rows older than the cutoff are exported and their SHA-256 checksum stored in
   `cleanup_backups`;
3. monthly rollups are refreshed into `monthly_summaries`;
4. the exported rows are deleted, and the run is recorded in `cleanup_runs`.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in the Supabase keys
npm run dev                        # http://localhost:3000
npx tsc --noEmit
node scripts/test-face-pipeline.mjs
node scripts/test-security-semantics.mjs
```

Required environment variables: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`HEALTHPLEX_TEMPLATE_KEY` (32 bytes, base64), `HEALTHPLEX_KIOSK_SALT`,
`NEXT_PUBLIC_APP_NAME`.

## Security notes

- Every table has RLS; browser roles can read only what their role permits, and
  `face_templates` is service-role only.
- `EXECUTE` is revoked from `PUBLIC`/`anon` on all public functions (Postgres grants it
  to `PUBLIC` by default, so revoking from `anon` alone is a no-op).
- Biometric enrolment requires recorded consent; withdrawal deletes the template.
- Attendance is corrected, never deleted, and every privileged action is audited.
- Liveness detection is a heuristic, **not** certified anti-spoofing. See the readiness
  statement before relying on attendance for graded outcomes.
