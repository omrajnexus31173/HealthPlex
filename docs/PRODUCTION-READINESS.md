# HEALTHPLEX — production readiness statement

Deployed application: **https://healthplex.vercel.app**
Supabase project: `shxtfzrbkutbwtkwilaq` (ap-south-1) · Vercel project: `prj_tzZIoxgUydZiivfa7Q5EqkDjqMBx` (iad1)

This document states exactly what has been verified, how, and what has **not**. It is
deliberately conservative: a claim appears under "verified" only if it was reproduced
against the deployed system or by a repeatable script in this repository.

---

## 1. Verified against the live deployment

### Infrastructure
| Item | Evidence |
| --- | --- |
| All Supabase services healthy | `auth`, `db`, `rest`, `storage`, `realtime` report `ACTIVE_HEALTHY` |
| App + database reachable in production | `GET /api/health` → `{"ok":true,"checks":{"env":{…all true},"database":{"ok":true,…}}}` |
| Database is empty apart from the bootstrap administrator | students 0, profiles 1, attendance 0, audit 0, backups 0, kiosks 0, equipment 0, sessions 0 |
| Auth is closed to the public | `disable_signup=true`, `mailer_autoconfirm=false`, refresh-token rotation on |
| Redirect URLs are allow-listed | `site_url=https://healthplex.vercel.app`; `/auth/callback` allow-listed for production and `localhost:3000` |
| Realtime actually publishes | publication `supabase_realtime` contains `attendance_records`, `notifications`, `kiosk_devices` with `replica identity full` |
| `/api/admin/*` answers JSON, not an HTML redirect | an unauthenticated fetch of `/api/admin/retention` returns a JSON 401 (confirmed on the production deployment; the previous deployment returned `302 → /login?next=…`) |
| Unauthenticated page loads are gated | `/retention` redirects to `/login?next=%2Fretention` |

### Security posture (probed with `set local role` / `request.jwt.claims`)
| Item | Evidence |
| --- | --- |
| `anon` cannot execute any public function | 0 executable functions after migration `008`; `authenticated` has 22 |
| Service-only functions stay service-only | `refresh_monthly_summaries`, `healthplex_retention_job` not executable by `authenticated` |
| Students read only their own data | student session sees 1 of 2 attendance rows and 1 of 2 student rows; `my_attendance_stats()` returns only their own totals |
| Students cannot write attendance | `insert into attendance_records` as the student role → `42501 permission denied` |
| Students can maintain their own profile | own `program`, `emergency_contact`, `phone` update succeeds |
| Trainers cannot see kiosk devices or retention internals | trainer session: 0 kiosk devices, 0 cleanup runs, 1 student (read-only roster) |
| Privilege escalation is blocked | guards reject role/status/consent escalation from the browser tier (migrations `004`, `005`) |
| Biometric templates are unreadable by any browser role | `face_templates` has no policy for `authenticated`; service role only |
| Templates are structurally validated | `face_templates_ciphertext_len/iv_len/auth_tag_len/dimension` reject a placeholder `\x00` template (`23514`) |

### Attendance semantics (exercised with real function calls, then rolled back)
| Item | Evidence |
| --- | --- |
| Entry marks attendance | `status=success, action=entry`, record `status=present`, `inside_count` 1, `capacity` 80 |
| Second scan closes the visit | `action=exit`, `duration_minutes` set, record `status=checked_out` |
| Check-out is never throttled | a scan with an open record always closes it |
| Re-entry is throttled for the cooldown window | third immediate scan → `status=cooldown`, no phantom record |
| Attempts are logged with reasons | `success/check_in`, `success/check_out`, `cooldown/re-entry within cooldown window` |
| An unpaired device key is rejected | raises `KIOSK_UNAUTHORIZED` (`28000`) |
| Kiosk roster works | `kiosk_students(key)` returns only consenting students with a granted template |
| Duplicate check-in cannot create two rows | unique `(student_id, check_in_at)` + `already_marked` path |

### Retention subsystem
| Item | Evidence |
| --- | --- |
| Disarmed by default | `retention_months=6`, `enabled=false`, `armed=false` |
| An unarmed cron run deletes nothing | logs `aborted`, `triggered_by=cron`, `error = "policy not armed — skipped"` |
| An armed run backs up then deletes | `success`, `deleted_records=1`, `candidate_records=1`, checksum-verified backup row written |
| Cutoff maths | 6 months before 2026-11-21 is 2026-05-21 (also asserted in `scripts/test-security-semantics.mjs`) |

### Recognition / biometrics (offline harness, no browser)
`node scripts/test-face-pipeline.mjs` → **15/15 PASS**, using the vendored
`@vladmandic/face-api` models and three distinct generated faces:

- genuine pair (same person, different session): distance **0.2626** → confidence **73.7 %**
- impostor pair: distance **0.7633** → confidence **23.7 %**
- class separation **0.501**; 128-dimensional descriptors
- two faces in frame → no identification; near-duplicate templates → `ambiguous`, never guessed
- static photograph (frozen landmarks) liveness **0.150** < 0.60 threshold → rejected
- head-turn span 0.350 for a live face vs 0.000 for a photo; blink 1.00 vs 0.00; combined live score 0.800

`node scripts/test-security-semantics.mjs` → **17/17 PASS**: AES-256-GCM envelope
(256-byte ciphertext, 12-byte IV, 16-byte tag) round-trips exactly (cosine 1.0, max
quantisation error 1.6e-5), rejects a single flipped byte and a wrong key; the server
gates accept the measured genuine match, reject the measured impostor and the static
photo, and are exact at both thresholds.

---

## 2. NOT verified — read before calling this production-ready

1. **No real camera, real browser, or real student has ever used this system.** The
   sandbox contains no browser (no Chromium/Firefox, Playwright cannot install), so
   every camera-dependent path is unproven end to end:
   - `getUserMedia` capture on the kiosk, model downloading in the browser, and
     descriptor extraction on real webcams/phones;
   - the enrolment wizard's live capture and the kiosk's auto-detect loop;
   - the live monitor and notification bell receiving realtime events in a browser
     (the publication is verified, the client subscription is not).
   The recognition maths and the server-side gates are proven as above, but the
   camera → browser → API path is not.
2. **Liveness is a heuristic, not certified.** Motion/blink/landmark checks reached
   0.80 on a live subject and 0.15 on a static photo, but this is **not** ISO/IEC
   30107-3 PAD testing. A determined attacker with a screen-replay or 3-D mask was not
   tested. Treat biometric attendance as a convenience control, not as proof of identity.
3. **The cron schedule has still never fired on its own.** While verifying it, a real
   bug was found and fixed: the job compared today against the *first* day of the next
   month, so the guard was false on every day the job is allowed to run (28–31) and
   `healthplex_retention_job()` would never have executed. Migration `012` recreates
   the job with a last-day-of-month guard; the guard now evaluates true only on
   2026-11-30 for the window 2026-11-28…12-01, and the armed job body was re-run
   afterwards and logged `success` with no error. The first unattended firing is
   therefore still in the future (2026-11-30 21:00 IST). Vercel Hobby allows one
   cron/day, so the schedule deliberately lives in `pg_cron`.
4. **Retention has not run against real data.** Every run was inside a rolled-back
   transaction. Storage-object deletion for archived student photos, and the behaviour
   at large volumes (hours of scanning, 10⁵+ rows), are untested.
5. **Email is unproven.** Accounts are created with a temporary password shown once to
   the administrator; password reset emails depend on Supabase's default SMTP, which
   has not been exercised (no inbox available here).
6. **Vercel → Supabase environment wiring is confirmed only server-side.** `/api/health`
   proves the server sees all five secrets; a browser-side sign-in through the deployed
   origin has not been performed. The super-admin password is known and **must be rotated**
   before handover.
7. **Scale and load are untested.** No concurrency test, no index review under load, no
   CDN/caching review beyond defaults.
8. **Accessibility and responsive behaviour are unverified** — no browser was available
   to inspect rendering.

---

## 3. Deliberate scope decisions

- Memberships, subscriptions, fees, payments, billing and expiry are **out of scope** and
  are not modelled anywhere in the schema or UI.
- Face templates are stored only as AES-256-GCM ciphertext; the data key lives in
  `HEALTHPLEX_TEMPLATE_KEY` and never reaches the browser.
- A student can withdraw biometric consent from their own dashboard; the template row is
  deleted first, then the flags are cleared, and the action is audited
  (`/api/me/withdraw-consent`).
- Attendance edits by staff are corrections, never deletes: the original row is
  preserved and the change is written to `audit_logs`.
- Retention requires an explicit arm/execute action by a super administrator; the
  scheduled job refuses to delete anything unless the policy is armed.

## 4. Residual risks to accept or fix

| Risk | Mitigation in place | Suggested follow-up |
| --- | --- | --- |
| Camera path untested | server re-validates confidence, liveness and device key | manual pilot with 5–10 staff/students on the actual kiosk hardware |
| Liveness spoofing | multi-signal heuristic + server threshold | consider certified PAD if attendance affects grades |
| Shared super-admin credentials | single bootstrap account, password must change | rotate password, add per-person admin accounts |
| Browser-based CRUD unexercised | RLS and API contracts verified at DB tier | short manual pass through each screen |
| Scheduled retention never observed | manual run verified, policy disarmed | arm it for one cycle with representative data, then inspect the backup |

---

## 5. How to reproduce

```bash
node scripts/test-face-pipeline.mjs      # 15/15 — recognition + liveness maths
node scripts/test-security-semantics.mjs # 17/17 — crypto envelope, gates, retention maths
npx tsc --noEmit                         # types
npx next build                           # production build
```

Database-side probes were executed through the Supabase connector as single
`begin … rollback` transactions so that no test data reached the deployed database.
