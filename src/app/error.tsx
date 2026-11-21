"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("HEALTHPLEX error:", error);
  }, [error]);
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <AlertTriangle size={26} className="text-warn-400" />
      <h1 className="mt-3 text-lg font-semibold text-white">Something went wrong</h1>
      <p className="mt-1 max-w-md text-xs text-ink-400">{error.message || "An unexpected error occurred while loading this view."}</p>
      <div className="mt-4 flex gap-2">
        <button onClick={reset} className="hp-btn hp-btn-primary">Try again</button>
        <a href="/" className="hp-btn hp-btn-ghost">Dashboard</a>
      </div>
    </div>
  );
}
