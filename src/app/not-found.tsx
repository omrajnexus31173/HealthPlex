import Link from "next/link";
import { Activity } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950">
        <Activity size={22} />
      </span>
      <h1 className="mt-4 text-xl font-semibold text-white">Page not found</h1>
      <p className="mt-1 max-w-sm text-xs text-ink-400">
        This route does not exist in HEALTHPLEX. Check the address or return to your dashboard.
      </p>
      <Link href="/" className="hp-btn hp-btn-primary mt-4">Go to dashboard</Link>
    </div>
  );
}
