"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type CameraState = "idle" | "requesting" | "ready" | "denied" | "unavailable" | "error";

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [resolution, setResolution] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const start = useCallback(
    async (preferredId?: string) => {
      setState("requesting");
      setError(null);
      try {
        if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
          setState("unavailable");
          setError(
            "Camera API unavailable. Use a modern browser over HTTPS (or localhost). On iOS Safari only https:// origins can access the camera.",
          );
          return;
        }
        stop();
        const stream = await navigator.mediaDevices.getUserMedia({
          video: preferredId
            ? { deviceId: { exact: preferredId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const s = track.getSettings();
        setResolution({ w: s.width ?? 0, h: s.height ?? 0 });
        const list = await navigator.mediaDevices.enumerateDevices();
        setDevices(list.filter((d) => d.kind === "videoinput"));
        setDeviceId(track.getSettings().deviceId ?? preferredId);
        setState("ready");
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setState("denied");
          setError("Camera permission was blocked. Allow camera access in the browser site settings, then reload the kiosk.");
        } else if (name === "NotFoundError" || name === "OverconstrainedError") {
          setState("unavailable");
          setError("No camera was found on this device. Connect a USB camera and reload.");
        } else {
          setState("error");
          setError(e instanceof Error ? e.message : "Unable to start the camera");
        }
      }
    },
    [stop],
  );

  useEffect(() => () => stop(), [stop]);

  return { videoRef, state, error, devices, deviceId, resolution, start, stop, setDeviceId };
}
