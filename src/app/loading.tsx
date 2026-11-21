export default function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-mint-400" />
        <p className="text-[10.5px] uppercase tracking-[0.25em] text-ink-400">HEALTHPLEX</p>
      </div>
    </div>
  );
}
