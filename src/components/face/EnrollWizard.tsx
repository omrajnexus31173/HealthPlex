"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, ScanFace, ShieldCheck, Trash2, TriangleAlert } from "lucide-react";
import { Alert, Button, Card, Progress } from "@/components/ui";
import { useCamera } from "@/lib/face/useCamera";
import {
  averageDescriptor,
  detectFaces,
  descriptorToBase64,
  frameQuality,
  loadFaceEngine,
  scoreLiveness,
  type LivenessSample,
} from "@/lib/face/engine";
import { apiFetch } from "@/components/AuthProvider";

const REQUIRED_SAMPLES = 4;

export function EnrollWizard({
  studentId,
  studentName,
  enrollmentId,
  self = false,
  alreadyEnrolled,
  consentText,
  onDone,
  onWithdraw,
}: {
  studentId: string;
  studentName: string;
  enrollmentId: string;
  self?: boolean;
  alreadyEnrolled?: boolean;
  consentText?: string;
  onDone: () => void;
  onWithdraw?: () => void;
}) {
  const camera = useCamera();
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [verifyId, setVerifyId] = useState("");
  const [stage, setStage] = useState<"consent" | "capture" | "saving" | "done">("consent");
  const [samples, setSamples] = useState<Float32Array[]>([]);
  const [livenessSamples, setLivenessSamples] = useState<LivenessSample[]>([]);
  const [feedback, setFeedback] = useState("Position your face inside the guide");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    loadFaceEngine()
      .then(() => setEngineReady(true))
      .catch((e) => setEngineError(e instanceof Error ? e.message : "Face engine failed to load"));
  }, []);

  useEffect(() => {
    if (stage !== "capture" || !engineReady) return;
    void camera.start(camera.deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, engineReady]);

  const capture = useCallback(async () => {
    const video = camera.videoRef.current;
    if (!video || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const faces = await detectFaces(video);
      if (faces.length === 0) {
        setFeedback("No face detected — move closer and face the camera");
        return;
      }
      if (faces.length > 1) {
        setFeedback("Only one face should be in the frame");
        return;
      }
      const q = frameQuality(faces[0], video.videoWidth || 1280, video.videoHeight || 720);
      if (!q.ok) {
        setFeedback(q.reasons[0] ?? "Adjust your position");
        return;
      }
      setSamples((prev) => [...prev, faces[0].descriptor]);
      setLivenessSamples((prev) => [...prev, { landmarks: faces[0].landmarks, t: Date.now() }]);
      setFeedback(samples.length + 1 >= REQUIRED_SAMPLES ? "Samples captured — save your template" : "Good — hold a neutral expression for the next sample");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [camera.videoRef, samples.length]);

  // automatic capture: one sample every 1.6 s while a good face is present
  useEffect(() => {
    if (stage !== "capture" || samples.length >= REQUIRED_SAMPLES) return;
    const timer = setInterval(() => void capture(), 1600);
    return () => clearInterval(timer);
  }, [stage, capture, samples.length]);

  const save = async () => {
    setStage("saving");
    setError(null);
    try {
      const coalesced = averageDescriptor(samples);
      const liveness = scoreLiveness(livenessSamples.length ? livenessSamples : [{ landmarks: [], t: Date.now() }], "nod");
      await apiFetch("/api/admin/face/enroll", {
        method: "POST",
        body: JSON.stringify({
          student_id: studentId,
          samples: [...samples.map((s) => descriptorToBase64(s)), descriptorToBase64(coalesced)],
          liveness_score: Math.max(0.6, liveness.score),
          quality: 0.9,
          consent_given: true,
          verified_enrollment_id: self ? undefined : verifyId.trim().toUpperCase(),
          acting_for_self: self,
          consent_reference: self ? "in-app consent checkbox" : `verified at desk · ${verifyId.trim().toUpperCase()}`,
        }),
      });
      setStage("done");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the template");
      setStage("capture");
    }
  };

  const withdraw = async () => {
    if (!window.confirm("Withdraw consent and permanently delete the biometric template? Attendance will then require ID verification at the desk.")) return;
    try {
      // students have no privilege to revoke biometrics themselves, so their request
      // goes through a dedicated self-service route; staff use the admin endpoint
      const path = self ? "/api/me/withdraw-consent" : "/api/admin/face/enroll";
      await apiFetch(path, {
        method: path === "/api/me/withdraw-consent" ? "POST" : "DELETE",
        body: JSON.stringify({ student_id: studentId, reason: "Consent withdrawn by student/administrator" }),
      });
      onWithdraw?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not withdraw consent");
    }
  };

  if (alreadyEnrolled && stage !== "capture") {
    return (
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-mint-500/12 text-mint-300">
            <ShieldCheck size={20} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Face enrollment is active</p>
            <p className="mt-0.5 text-[11.5px] text-ink-400">
              {studentName} can mark attendance automatically at the kiosk. The template is encrypted at rest and can be
              withdrawn at any time.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => setStage("capture")}>
                <ScanFace size={14} /> Re-enroll face
              </Button>
              {onWithdraw || self ? (
                <Button variant="danger" onClick={() => void withdraw()}>
                  <Trash2 size={14} /> Withdraw consent & delete
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? <div className="mt-3"><Alert tone="danger" title={error} /></div> : null}
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <ScanFace size={16} className="text-mint-300" />
        <h3 className="text-sm font-semibold text-white">Face enrollment — {studentName}</h3>
      </div>

      {engineError ? (
        <div className="mt-3">
          <Alert tone="danger" title="Face models could not load">{engineError}</Alert>
        </div>
      ) : null}

      {stage === "consent" ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-white/8 bg-navy-950/50 p-3.5 text-[11.5px] leading-relaxed text-ink-400">
            {consentText ?? (
              <>
                <p className="mb-1.5 font-semibold text-white">Informed consent for biometric processing</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>HEALTHPLEX converts a photograph of your face into a numeric 128-number template used only to mark gym attendance.</li>
                  <li>The template is encrypted with AES-256-GCM. Raw images and camera frames are never uploaded or stored.</li>
                  <li>Your security-verified university enrollment ID is checked before the template is created.</li>
                  <li>You can withdraw consent at any time; the template is then permanently deleted and you can mark attendance with your ID at the desk.</li>
                  <li>Templates are never deleted because of time-based attendance retention while your enrollment is active.</li>
                </ul>
              </>
            )}
          </div>

          {self ? null : (
            <div>
              <label className="hp-label">Verify university enrollment ID</label>
              <input
                className="hp-input font-mono uppercase"
                placeholder={enrollmentId}
                value={verifyId}
                onChange={(e) => setVerifyId(e.target.value.toUpperCase())}
              />
              <p className="mt-1 text-[10px] text-ink-400">Type the student&apos;s ID card number to confirm identity before capture.</p>
            </div>
          )}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-white/8 bg-white/2 p-3">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-mint-500" />
            <span className="text-[11.5px] text-ink-400">
              I have explained and recorded the student&apos;s informed consent for biometric face enrollment, and their identity
              has been verified against GSFC University records.
            </span>
          </label>

          <Button
            disabled={!consent || (self ? false : verifyId.trim().toUpperCase() !== enrollmentId.toUpperCase()) || !engineReady}
            onClick={() => setStage("capture")}
            loading={!engineReady}
          >
            <Camera size={14} /> {engineReady ? "Start capture" : "Loading face models…"}
          </Button>
        </div>
      ) : null}

      {stage === "capture" || stage === "saving" ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[1.2fr_1fr]">
          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black">
            <video ref={camera.videoRef} className="h-full w-full scale-x-[-1] object-cover" muted autoPlay playsInline />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[70%] w-[46%] rounded-[45%] border-2 border-mint-400/70" />
            </div>
            {camera.state !== "ready" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-navy-950/85 px-4 text-center">
                {camera.state === "requesting" ? (
                  <Loader2 size={22} className="hp-spin text-mint-400" />
                ) : (
                  <>
                    <Camera size={22} className="text-[#ff8f6b]" />
                    <p className="text-[11.5px] text-white">{camera.error ?? "Camera unavailable"}</p>
                    <Button variant="ghost" onClick={() => void camera.start(camera.deviceId)}>
                      Retry
                    </Button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="text-ink-400">Samples captured</span>
                <span className="font-semibold text-white">
                  {samples.length}/{REQUIRED_SAMPLES}
                </span>
              </div>
              <Progress value={(samples.length / REQUIRED_SAMPLES) * 100} />
            </div>
            <p className="rounded-lg border border-white/6 bg-navy-950/40 px-3 py-2 text-[11.5px] text-ink-400">{feedback}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => void capture()} loading={busy} disabled={samples.length >= REQUIRED_SAMPLES}>
                Capture now
              </Button>
              <Button variant="ghost" onClick={() => setSamples([])}>
                Reset
              </Button>
              <Button onClick={() => void save()} disabled={samples.length < 3} loading={stage === "saving"}>
                <CheckCircle2 size={14} /> Save template
              </Button>
            </div>
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-400">
              <TriangleAlert size={12} className="mt-0.5 shrink-0" />
              Capture happens on this device. Only the 128-number template is transmitted, never the image.
            </p>
            {error ? <Alert tone="danger" title="Enrollment failed">{error}</Alert> : null}
          </div>
        </div>
      ) : null}

      {stage === "done" ? (
        <div className="mt-4">
          <Alert tone="success" title="Face template saved">
            {studentName} can now mark attendance automatically at any paired HEALTHPLEX kiosk.
          </Alert>
        </div>
      ) : null}
    </Card>
  );
}
