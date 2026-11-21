"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Camera,
  CameraOff,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Loader2,
  RefreshCw,
  ScanFace,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { StaffGuard } from "@/components/StaffGuard";
import { Button, Card } from "@/components/ui";
import { useCamera } from "@/lib/face/useCamera";
import {
  CHALLENGE_TEXT,
  detectFaces,
  frameQuality,
  loadFaceEngine,
  randomChallenge,
  scoreLiveness,
  type Challenge,
  type FaceSample,
  type LivenessSample,
} from "@/lib/face/engine";
import { identify, type EnrolledTemplate, type ScanOutcome } from "@/lib/face/recognition";
import {
  clearKiosk,
  fetchTemplates,
  getStoredKiosk,
  linkKiosk,
  logAttempt,
  submitScan,
  type KioskDeviceSession,
  type KioskStudentRow,
  type ScanResponse,
  type TemplateBundle,
} from "@/lib/face/kioskClient";
import { fmtClock, timeAgo } from "@/lib/format";

type Phase = "idle" | "detecting" | "challenge" | "recognising" | "submitting" | "success" | "failure" | "cooldown";
type ResultCard = {
  tone: "success" | "warn" | "danger";
  title: string;
  message: string;
  name?: string;
  enrollment?: string;
  photo?: string | null;
  time?: string;
  action?: "entry" | "exit";
  details?: string;
};

// Sampling cadence. A blink lasts ~150 ms; at 420 ms the detector skips right over it,
// which is why a genuine user kept failing the blink challenge while their eyes were
// demonstrably closing. ~180 ms keeps a blink inside the sampled window at ~6 fps of
// landmark extraction, which any kiosk-class machine sustains.
const SCAN_INTERVAL_MS = 180;
const BLINK_SCAN_INTERVAL_MS = 120;
/** How long the challenge runs before it is scored. */
const CHALLENGE_MS = 4200;

function KioskInner() {
  const { profile, settings, supabase } = useAuth();
  const camera = useCamera();
  const videoRef = camera.videoRef;

  const [device, setDevice] = useState<KioskDeviceSession | null>(null);
  const [pairCode, setPairCode] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairing, setPairing] = useState(false);

  const [bundle, setBundle] = useState<TemplateBundle | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [bundleError, setBundleError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [status, setStatus] = useState("Starting camera…");
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<ResultCard | null>(null);
  const [facesSeen, setFacesSeen] = useState(0);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [challengeProgress, setChallengeProgress] = useState(0);
  const [confidenceShown, setConfidenceShown] = useState<number | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [recent, setRecent] = useState<{ id: string; name: string; at: string; action: string }[]>([]);
  const [insideCount, setInsideCount] = useState<number | null>(null);

  const templatesRef = useRef<EnrolledTemplate[]>([]);
  const studentsRef = useRef<Map<string, KioskStudentRow>>(new Map());
  const photosRef = useRef<Record<string, string>>({});
  const phaseRef = useRef<Phase>("idle");
  const busyRef = useRef(false);
  const livenessRef = useRef<LivenessSample[]>([]);
  const challengeRef = useRef<Challenge | null>(null);
  const challengeStartRef = useRef(0);
  const lastSeenRef = useRef(0);
  const mountedRef = useRef(true);

  const cfg = bundle?.config ?? null;

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    mountedRef.current = true;
    setDevice(getStoredKiosk());
    const tick = setInterval(() => setClock(new Date()), 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(tick);
    };
  }, []);

  /* ------------------------------------------------------------ models */
  useEffect(() => {
    let cancelled = false;
    loadFaceEngine()
      .then(() => !cancelled && setEngineReady(true))
      .catch((e) => !cancelled && setEngineError(e instanceof Error ? e.message : "Face models failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------------------ camera */
  useEffect(() => {
    if (!device) return;
    if (!engineReady) return;
    void camera.start(camera.deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, engineReady]);

  /* --------------------------------------------------------- templates */
  const syncTemplates = useCallback(
    async (session: KioskDeviceSession) => {
      try {
        setBundleError(null);
        const data = await fetchTemplates(session.code);
        templatesRef.current = data.templates;
        studentsRef.current = new Map(data.students.map((s) => [s.student_id, s]));
        photosRef.current = data.signed_photo_urls;
        setBundle(data);
        setInsideCount(null);
        setLastSync(new Date().toISOString());
      } catch (e) {
        setBundleError(e instanceof Error ? e.message : "Unable to load enrolled templates");
      }
    },
    [],
  );

  useEffect(() => {
    if (!device) return;
    void syncTemplates(device);
    const timer = setInterval(() => void syncTemplates(device), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [device, syncTemplates]);

  /* ------------------------------------------------------ occupancy poll */
  useEffect(() => {
    if (!device) return;
    const load = async () => {
      const { data } = await supabase.rpc("live_feed", { p_limit: 8 });
      const rows = (data as { check_in_at: string; check_out_at: string | null; full_name: string; id: string }[]) ?? [];
      if (!mountedRef.current) return;
      setRecent(
        rows.slice(0, 5).map((r) => ({
          id: r.id,
          name: r.full_name,
          at: r.check_out_at ?? r.check_in_at,
          action: r.check_out_at ? "exit" : "entry",
        })),
      );
    };
    void load();
    const timer = setInterval(() => void load(), 15000);
    return () => clearInterval(timer);
  }, [device, supabase, lastSync]);

  const pair = async (e: React.FormEvent) => {
    e.preventDefault();
    setPairing(true);
    setPairError(null);
    try {
      await linkKiosk(pairCode);
      setDevice(getStoredKiosk());
    } catch (err) {
      setPairError(err instanceof Error ? err.message : "Pairing failed");
    } finally {
      setPairing(false);
    }
  };

  const resetToIdle = useCallback((delay = 4200) => {
    window.setTimeout(() => {
      if (!mountedRef.current) return;
      busyRef.current = false;
      livenessRef.current = [];
      challengeRef.current = null;
      setChallenge(null);
      setChallengeProgress(0);
      setResult(null);
      setConfidenceShown(null);
      setPhase("idle");
      setStatus("Scanning for a face…");
      setHint(null);
    }, delay);
  }, []);

  const fail = useCallback(
    (card: ResultCard, attempt?: { result: string; reason?: string; student?: string | null; confidence?: number; secondBest?: number; liveness?: number; faces?: number }) => {
      setResult(card);
      setPhase("failure");
      if (attempt && device) {
        void logAttempt({
          code: device.code,
          studentId: attempt.student ?? null,
          result: attempt.result,
          confidence: attempt.confidence,
          secondBest: attempt.secondBest,
          liveness: attempt.liveness,
          faces: attempt.faces,
          reason: attempt.reason,
        }).catch(() => undefined);
      }
      resetToIdle(4600);
    },
    [device, resetToIdle],
  );

  const complete = useCallback(
    async (studentId: string, confidence: number, liveness: number, faces: number) => {
      if (!device) return;
      setPhase("submitting");
      setStatus("Verifying with the gym server…");
      let res: ScanResponse | null = null;
      try {
        res = await submitScan({
          code: device.code,
          studentId,
          confidence,
          liveness,
          faces,
          meta: { threshold: cfg?.recognition_threshold, liveness_threshold: cfg?.liveness_threshold },
        });
        const student = studentsRef.current.get(studentId);
        if (res.status === "success" && res.student) {
          setResult({
            tone: "success",
            title: res.action === "exit" ? "Exit recorded" : "Attendance marked",
            message: res.message,
            name: res.student.name,
            enrollment: res.student.enrollment,
            photo: res.student.photo_path ? photosRef.current[studentId] : null,
            time: res.record?.check_in_at,
            action: res.action,
            details: `${(confidence * 100).toFixed(1)}% match · liveness ${(liveness * 100).toFixed(0)}%`,
          });
          setInsideCount(res.inside_count ?? null);
          setPhase("success");
          setStatus("Attendance recorded");
        } else if (res.status === "cooldown" || res.status === "duplicate") {
          setResult({
            tone: "warn",
            title: "Already recorded",
            message: res.message,
            name: res.student?.name ?? student?.full_name,
            enrollment: res.student?.enrollment ?? student?.enrollment_id,
            photo: photosRef.current[studentId] ?? null,
          });
          setPhase("cooldown");
        } else if (res.status === "inactive") {
          setResult({
            tone: "danger",
            title: "Account not active",
            message: res.message,
            name: res.student?.name,
            enrollment: res.student?.enrollment,
            photo: photosRef.current[studentId] ?? null,
          });
          setPhase("failure");
        } else {
          setResult({ tone: "danger", title: "Not recorded", message: res.message });
          setPhase("failure");
        }
      } catch (e) {
        setResult({
          tone: "danger",
          title: "Server rejected the scan",
          message: e instanceof Error ? e.message : "Attendance could not be recorded",
        });
        setPhase("failure");
      } finally {
        setConfidenceShown(confidence);
        resetToIdle(res?.status === "success" ? 5200 : 4600);
      }
    },
    [cfg, device, resetToIdle],
  );

  /* --------------------------------------------------- detection loop */
  useEffect(() => {
    if (!device || !bundle || !engineReady || camera.state !== "ready") return;
    let running = true;

    const loop = async () => {
      if (!running) return;
      const video = videoRef.current;
      const p = phaseRef.current;
      if (!video || video.readyState < 2 || busyRef.current || p === "success" || p === "submitting" || p === "failure" || p === "cooldown") {
        window.setTimeout(loop, SCAN_INTERVAL_MS);
        return;
      }

      try {
        const samples = await detectFaces(video);
        if (!running || busyRef.current) return;
        setFacesSeen(samples.length);

        if (samples.length === 0) {
          if (phaseRef.current !== "challenge") {
            setPhase("idle");
            setStatus("Looking for a face…");
            setHint("Stand in front of the kiosk and look at the camera");
          }
          lastSeenRef.current = 0;
          window.setTimeout(loop, SCAN_INTERVAL_MS);
          return;
        }

        if (samples.length > 1) {
          if (Date.now() - lastSeenRef.current > 4000) {
            lastSeenRef.current = Date.now();
            busyRef.current = true;
            fail(
              {
                tone: "warn",
                title: "One person at a time",
                message: "Multiple faces detected. Please enter the frame one at a time so attendance is never guessed.",
              },
              { result: "multiple_faces", faces: samples.length, reason: `${samples.length} faces in frame` },
            );
          } else {
            setHint("Only one student should be in front of the camera");
            window.setTimeout(loop, SCAN_INTERVAL_MS);
          }
          return;
        }

        const sample = samples[0];
        const q = frameQuality(sample, video.videoWidth || 1280, video.videoHeight || 720);
        if (!q.ok) {
          setPhase("detecting");
          setStatus(q.reasons[0] ?? "Adjust your position");
          setHint(q.reasons.join(" · "));
          lastSeenRef.current = 0;
          window.setTimeout(loop, SCAN_INTERVAL_MS);
          return;
        }

        // ---- liveness challenge choreography
        if (!challengeRef.current) {
          const c = randomChallenge();
          challengeRef.current = c;
          challengeStartRef.current = Date.now();
          livenessRef.current = [{ landmarks: sample.landmarks, t: Date.now() }];
          setChallenge(c);
          setPhase("challenge");
          setChallengeProgress(0);
          setStatus(CHALLENGE_TEXT[c]);
          setHint("Liveness check keeps photos and screens from marking attendance");
          window.setTimeout(loop, c === "blink" ? BLINK_SCAN_INTERVAL_MS : SCAN_INTERVAL_MS);
          return;
        }

        const elapsed = Date.now() - challengeStartRef.current;
        livenessRef.current.push({ landmarks: sample.landmarks, t: Date.now() });
        setChallengeProgress(Math.min(100, Math.round((elapsed / CHALLENGE_MS) * 100)));
        const cadence = challengeRef.current === "blink" ? BLINK_SCAN_INTERVAL_MS : SCAN_INTERVAL_MS;

        if (elapsed < CHALLENGE_MS) {
          setStatus(CHALLENGE_TEXT[challengeRef.current]);
          window.setTimeout(loop, cadence);
          return;
        }

        // ---- evaluate liveness then identify
        busyRef.current = true;
        setPhase("recognising");
        setStatus("Verifying your identity…");
        const live = scoreLiveness(livenessRef.current, challengeRef.current);
        const threshold = cfg?.liveness_threshold ?? 0.6;
        if (live.score < threshold) {
          fail(
            {
              tone: "danger",
              title: "Liveness check failed",
              message: `${live.reason ?? "We could not confirm a live face"} (score ${(live.score * 100).toFixed(0)}%). Photos, videos and phone screens cannot mark attendance.`,
            },
            {
              result: "liveness_failed",
              confidence: undefined,
              liveness: live.score,
              faces: 1,
              reason: live.reason ?? "liveness score below threshold",
            },
          );
          return;
        }

        const fresh = await detectFaces(video);
        if (fresh.length !== 1) {
          fail(
            { tone: "warn", title: "Frame changed", message: "Keep one face in the frame while attendance is captured." },
            { result: fresh.length ? "multiple_faces" : "no_face", faces: fresh.length, liveness: live.score },
          );
          return;
        }

        const outcome: ScanOutcome = identify(fresh, templatesRef.current, {
          threshold: cfg?.recognition_threshold ?? 0.48,
          margin: cfg?.recognition_margin ?? 0.06,
        });

        if (outcome.kind === "match") {
          await complete(outcome.studentId, outcome.confidence, live.score, 1);
          return;
        }
        if (outcome.kind === "ambiguous") {
          fail(
            {
              tone: "warn",
              title: "Match too close to call",
              message: "Two enrolled profiles are equally close. Please use ID verification at the desk instead.",
            },
            { result: "ambiguous_match", confidence: outcome.confidence, secondBest: outcome.second, liveness: live.score, faces: 1 },
          );
          return;
        }
        if (outcome.kind === "multiple_faces") {
          fail({ tone: "warn", title: "One person at a time", message: "Multiple faces detected." }, { result: "multiple_faces", faces: outcome.count });
          return;
        }
        if (outcome.kind === "no_face") {
          fail({ tone: "warn", title: "Face lost", message: "Please stay in front of the camera." }, { result: "no_face" });
          return;
        }
        // unknown
        const low = outcome.confidence > 0;
        fail(
          {
            tone: "danger",
            title: low ? "Not recognised" : "No enrolled face",
            message: low
              ? `Best match was only ${(outcome.confidence * 100).toFixed(0)}% — below the ${Math.round((cfg?.recognition_threshold ?? 0.48) * 100)}% requirement. Visit the gym desk for ID verification.`
              : "This face is not enrolled for gym attendance. Visit the gym desk to complete face enrollment.",
          },
          {
            result: low ? "low_confidence" : "unknown_face",
            confidence: outcome.confidence,
            liveness: live.score,
            faces: 1,
          },
        );
      } catch {
        window.setTimeout(loop, 1200);
      }
    };

    void loop();
    return () => {
      running = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [device, bundle, engineReady, camera.state, complete, fail, cfg]);

  /* ------------------------------------------------------------- views */
  const cameraBadge = useMemo(() => {
    const map: Record<string, { label: string; tone: string }> = {
      idle: { label: "Camera idle", tone: "text-ink-400" },
      requesting: { label: "Requesting camera…", tone: "text-warn-400" },
      ready: { label: "Camera live", tone: "text-mint-300" },
      denied: { label: "Camera blocked", tone: "text-[#ffb2a1]" },
      unavailable: { label: "No camera", tone: "text-[#ffb2a1]" },
      error: { label: "Camera error", tone: "text-[#ffb2a1]" },
    };
    return map[camera.state] ?? map.idle;
  }, [camera.state]);

  if (!device) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-5 py-10">
        <Card className="p-7">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950">
              <Fingerprint size={22} />
            </span>
            <div>
              <h1 className="text-lg font-bold text-white">Pair this kiosk</h1>
              <p className="text-xs text-ink-400">HEALTHPLEX attendance station · GSFC University</p>
            </div>
          </div>
          <p className="mt-4 text-[12.5px] leading-relaxed text-ink-400">
            Enter the device key generated by a gym administrator (Kiosk Devices page). This device is remembered locally
            and can be revoked at any time. The key is stored only as a hash in the database.
          </p>
          <form onSubmit={pair} className="mt-4 space-y-3">
            <div>
              <label className="hp-label" htmlFor="code">
                Device key
              </label>
              <div className="relative">
                <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
                <input
                  id="code"
                  className="hp-input pl-9 font-mono text-[12.5px]"
                  placeholder="hpk_xxxxxxxxxxxxxxxxxxxxxxxx"
                  value={pairCode}
                  onChange={(e) => setPairCode(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            {pairError ? <p className="text-xs text-[#ffb2a1]">{pairError}</p> : null}
            <Button type="submit" loading={pairing} className="w-full">
              Pair kiosk
            </Button>
          </form>
          <div className="mt-5 flex items-center justify-between text-[11px] text-ink-400">
            <span>Signed in as {profile?.full_name}</span>
            <Link href="/dashboard" className="inline-flex items-center gap-1 text-mint-300 hover:underline">
              <ArrowLeft size={12} /> Dashboard
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const tzTime = new Intl.DateTimeFormat("en-IN", {
    timeZone: bundle?.config.timezone ?? "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(clock);
  const tzDate = new Intl.DateTimeFormat("en-IN", {
    timeZone: bundle?.config.timezone ?? "Asia/Kolkata",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(clock);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#03080f]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_500px_at_50%_-10%,rgba(33,201,138,0.12),transparent_60%)]" />

      <div className="relative flex min-h-dvh flex-col">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950 shadow-lg shadow-mint-600/25">
              <Activity size={22} strokeWidth={2.7} />
            </span>
            <div>
              <p className="text-lg font-bold leading-none tracking-tight text-white">HEALTHPLEX</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-ink-400">
                GSFC University · Attendance Kiosk
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-xl border border-white/8 bg-white/4 px-3 py-1.5 sm:flex">
              <span className={`h-2 w-2 rounded-full ${camera.state === "ready" ? "bg-mint-400" : "bg-[#ff8f6b]"}`} />
              <span className={`text-[11px] font-medium ${cameraBadge.tone}`}>{cameraBadge.label}</span>
            </div>
            <div className="text-right">
              <p className="font-mono text-xl font-semibold tabular-nums leading-none text-white">{tzTime}</p>
              <p className="mt-1 text-[10.5px] text-ink-400">{tzDate} · IST</p>
            </div>
            <Link href="/dashboard" className="rounded-xl border border-white/8 bg-white/4 p-2 text-ink-400 hover:text-white" aria-label="Exit kiosk">
              <ArrowLeft size={16} />
            </Link>
          </div>
        </header>

        <div className="grid flex-1 gap-5 px-5 pb-6 md:px-8 lg:grid-cols-[1.6fr_1fr]">
          {/* camera stage */}
          <div className="flex flex-col gap-4">
            <div
              className={`relative aspect-video w-full overflow-hidden rounded-3xl border ${
                phase === "success" ? "border-mint-400/70 hp-success-flash" : phase === "failure" ? "border-[#ff5e47]/50" : "border-white/10"
              } bg-black`}
            >
              <video
                ref={videoRef}
                className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-500 ${phase === "success" ? "opacity-90" : "opacity-100"}`}
                playsInline
                muted
                autoPlay
              />

              {/* overlays */}
              <div className="pointer-events-none absolute inset-0">
                {camera.state !== "ready" ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 bg-navy-950/80 px-6 text-center">
                    {camera.state === "requesting" ? (
                      <>
                        <Loader2 size={26} className="hp-spin text-mint-400" />
                        <p className="text-sm text-ink-400">Requesting camera permission…</p>
                      </>
                    ) : (
                      <>
                        <CameraOff size={30} className="text-[#ff8f6b]" />
                        <p className="max-w-sm text-sm font-medium text-white">{camera.error ?? "Camera is not available"}</p>
                        <button className="hp-btn hp-btn-ghost mt-1" onClick={() => void camera.start(camera.deviceId)}>
                          <RefreshCw size={14} /> Retry camera
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {/* face guide */}
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div
                        className={`relative h-[72%] w-[46%] rounded-[45%] border-2 transition-colors duration-300 ${
                          phase === "success"
                            ? "border-mint-400"
                            : phase === "failure"
                              ? "border-[#ff5e47]"
                              : facesSeen === 1
                                ? "border-mint-400/80"
                                : "border-white/25"
                        }`}
                      >
                        {phase === "challenge" || phase === "recognising" || phase === "detecting" ? (
                          <div className="absolute inset-x-3 top-1/2 h-px bg-gradient-to-r from-transparent via-mint-400 to-transparent hp-scanline" />
                        ) : null}
                        {facesSeen === 1 && (phase === "idle" || phase === "challenge") ? (
                          <span className="absolute -inset-3 rounded-[45%] border border-mint-400/40 hp-ring" />
                        ) : null}
                      </div>
                    </div>

                    {/* corner brackets */}
                    {[
                      "left-5 top-5 border-l-2 border-t-2",
                      "right-5 top-5 border-r-2 border-t-2",
                      "left-5 bottom-5 border-b-2 border-l-2",
                      "right-5 bottom-5 border-b-2 border-r-2",
                    ].map((c) => (
                      <span key={c} className={`absolute h-8 w-8 rounded-sm border-mint-500/50 ${c}`} />
                    ))}

                    {/* status pill */}
                    <div className="absolute inset-x-0 top-4 flex justify-center">
                      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-navy-950/75 px-3.5 py-1.5 backdrop-blur">
                        {phase === "success" ? (
                          <CheckCircle2 size={14} className="text-mint-400" />
                        ) : phase === "failure" ? (
                          <XCircle size={14} className="text-[#ff8f6b]" />
                        ) : phase === "challenge" ? (
                          <ShieldCheck size={14} className="text-mint-300" />
                        ) : (
                          <ScanFace size={14} className="text-mint-300" />
                        )}
                        <span className="text-[12px] font-medium text-white">{status}</span>
                      </div>
                    </div>

                    {challenge && (phase === "challenge" || phase === "recognising") ? (
                      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
                        <p className="rounded-full bg-mint-500/15 px-3 py-1 text-[11.5px] font-semibold text-mint-200">
                          Liveness check · {CHALLENGE_TEXT[challenge]}
                        </p>
                        <div className="h-1 w-40 overflow-hidden rounded-full bg-white/15">
                          <div className="h-full rounded-full bg-mint-400" style={{ width: `${challengeProgress}%`, transition: "width 150ms linear" }} />
                        </div>
                      </div>
                    ) : null}

                    {/* face count */}
                    <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-white/10 bg-navy-950/70 px-2.5 py-1 text-[10.5px] text-ink-400 backdrop-blur">
                      <Users size={12} /> {facesSeen} face{facesSeen === 1 ? "" : "s"} detected
                    </div>
                    {camera.devices.length > 1 ? (
                      <div className="absolute bottom-4 right-4">
                        <select
                          className="rounded-lg border border-white/10 bg-navy-950/80 px-2 py-1 text-[10.5px] text-ink-400 backdrop-blur"
                          value={camera.deviceId ?? ""}
                          onChange={(e) => void camera.start(e.target.value)}
                        >
                          {camera.devices.map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || `Camera ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            {/* result panel */}
            <div
              className={`relative min-h-[132px] overflow-hidden rounded-3xl border p-4 transition-colors duration-300 ${
                result?.tone === "success"
                  ? "border-mint-500/40 bg-mint-500/8"
                  : result?.tone === "warn"
                    ? "border-warn-400/40 bg-warn-400/8"
                    : result?.tone === "danger"
                      ? "border-[#ff5e47]/40 bg-[#ff5e47]/8"
                      : "border-white/8 bg-white/3"
              }`}
            >
              {result ? (
                <div className="flex items-center gap-4 hp-pop">
                  {result.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={result.photo} alt={result.name ?? "student"} className="h-20 w-20 rounded-2xl object-cover ring-2 ring-white/20" />
                  ) : (
                    <div
                      className={`flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl ${
                        result.tone === "success" ? "bg-mint-500/15 text-mint-300" : "bg-white/6 text-ink-400"
                      }`}
                    >
                      {result.tone === "success" ? <CheckCircle2 size={34} /> : <ShieldAlert size={30} />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`hp-chip ${
                          result.tone === "success"
                            ? "border-mint-500/30 bg-mint-500/12 text-mint-300"
                            : result.tone === "warn"
                              ? "border-warn-400/30 bg-warn-400/12 text-warn-400"
                              : "border-[#ff5e47]/30 bg-[#ff5e47]/12 text-[#ffb2a1]"
                        }`}
                      >
                        {result.title}
                      </span>
                      {result.action ? <span className="text-[10.5px] uppercase tracking-wider text-ink-400">{result.action}</span> : null}
                    </div>
                    <p className="mt-1.5 truncate text-xl font-semibold leading-tight text-white">{result.name ?? "—"}</p>
                    <p className="truncate text-[12.5px] text-ink-400">
                      {result.enrollment ? `${result.enrollment} · ` : ""}
                      {result.message}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-[10.5px] text-ink-400">
                      {result.time ? <span>Server time {fmtClock(result.time)} IST</span> : null}
                      {result.details ? <span>{result.details}</span> : null}
                      {confidenceShown != null ? <span>confidence {(confidenceShown * 100).toFixed(1)}%</span> : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-1 py-3 text-center">
                  <p className="text-sm font-medium text-white">Look at the camera to mark attendance</p>
                  <p className="text-[11.5px] text-ink-400">
                    {bundle
                      ? `${templatesRef.current.length} face templates loaded · automatic, no button needed`
                      : bundleError ?? "Loading enrolled templates…"}
                  </p>
                  {hint ? <p className="text-[11px] text-mint-300/80">{hint}</p> : null}
                </div>
              )}
            </div>
          </div>

          {/* side panel */}
          <div className="space-y-4">
            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">How it works</p>
              <ol className="mt-2.5 space-y-2">
                {[
                  "Stand in front of the camera — detection is automatic.",
                  "Complete the random liveness prompt (blink, turn, smile).",
                  "The system matches your enrolled face on this device.",
                  "Attendance is stored with server time in Asia/Kolkata.",
                ].map((t, i) => (
                  <li key={t} className="flex gap-2 text-[11.5px] text-ink-400">
                    <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-mint-500/15 text-[9.5px] font-bold text-mint-300">
                      {i + 1}
                    </span>
                    {t}
                  </li>
                ))}
              </ol>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Device</p>
                <button
                  className="text-[10.5px] text-ink-400 hover:text-[#ffb2a1]"
                  onClick={() => {
                    clearKiosk();
                    setDevice(null);
                    setBundle(null);
                  }}
                >
                  Unpair
                </button>
              </div>
              <p className="mt-1.5 text-[13px] font-semibold text-white">{device.name}</p>
              <p className="text-[11px] text-ink-400">{device.location ?? "Gym entrance"}</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded-lg border border-white/6 bg-navy-950/40 p-2">
                  <p className="text-ink-400">Templates</p>
                  <p className="font-semibold text-white">
                    {templatesRef.current.length}
                    {bundle ? <span className="text-[10px] font-normal text-ink-400"> / {bundle.sync.enrolled_students}</span> : null}
                  </p>
                </div>
                <div className="rounded-lg border border-white/6 bg-navy-950/40 p-2">
                  <p className="text-ink-400">Last sync</p>
                  <p className="font-semibold text-white">{lastSync ? timeAgo(lastSync) : "—"}</p>
                </div>
                <div className="rounded-lg border border-white/6 bg-navy-950/40 p-2">
                  <p className="text-ink-400">Capacity</p>
                  <p className="font-semibold text-white">{cfg?.capacity ?? "—"}</p>
                </div>
                <div className="rounded-lg border border-white/6 bg-navy-950/40 p-2">
                  <p className="text-ink-400">Threshold</p>
                  <p className="font-semibold text-white">{cfg ? `${Math.round((1 - cfg.recognition_threshold) * 100)}%` : "—"}</p>
                </div>
              </div>
              {bundleError ? <p className="mt-2 text-[10.5px] text-[#ffb2a1]">{bundleError}</p> : null}
              {/* Why the count is what it is — "Templates 0" alone hid a server-side
                  decryption failure behind what looked like "nobody has enrolled". */}
              {bundle?.sync.problems.map((p) => (
                <p key={p} className="mt-2 text-[10.5px] text-warn-400">
                  {p}
                </p>
              ))}
              {bundle?.sync.excluded.map((e) => (
                <p key={e.reason} className="mt-1 text-[10px] text-ink-400">
                  {e.count} × {e.reason}
                </p>
              ))}
              {bundle && bundle.sync.templates_loaded > 0 ? (
                <p className="mt-2 text-[10px] text-mint-300">
                  {bundle.sync.templates_loaded} of {bundle.sync.enrolled_students} enrolled students are matchable on this device.
                </p>
              ) : null}
              {engineError ? <p className="mt-2 text-[10.5px] text-[#ffb2a1]">Face models: {engineError}</p> : null}
              {!engineReady && !engineError ? (
                <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-400">
                  <Loader2 size={11} className="hp-spin" /> Loading face recognition models (7 MB, once per device)…
                </p>
              ) : null}
            </Card>

            <Card className="p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">Recent activity</p>
              {recent.length === 0 ? (
                <p className="mt-2 text-[11.5px] text-ink-400">No attendance activity recorded yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {recent.map((r) => (
                    <li key={`${r.id}-${r.action}`} className="flex items-center gap-2 text-[11.5px]">
                      <span className={`h-1.5 w-1.5 rounded-full ${r.action === "exit" ? "bg-sky-400" : "bg-mint-400"}`} />
                      <span className="min-w-0 flex-1 truncate text-ink-400">{r.name}</span>
                      <span className="shrink-0 text-[10.5px] text-ink-400/70">{fmtClock(r.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <div className="rounded-2xl border border-white/6 bg-white/2 p-3">
              <p className="flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-400/80">
                <Camera size={13} className="mt-0.5 shrink-0" />
                Camera frames are processed on this device and never uploaded. Only a 128-D numeric template match and liveness
                score reach the server.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function KioskPage() {
  return (
    <StaffGuard>
      <KioskInner />
    </StaffGuard>
  );
}
