"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import * as Icons from "lucide-react";
import { Activity, Bell, ChevronDown, LogOut, Menu, ShieldCheck, X } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { ROLE_HOME, ROLE_LABEL, navFor, type NavItem } from "@/lib/roles";
import { Avatar, Card } from "./ui";
import type { Notification } from "@/lib/types";
import { timeAgo } from "@/lib/format";

function Icon({ name, size = 17 }: { name: string; size?: number }) {
  const Cmp = (Icons as unknown as Record<string, React.ComponentType<{ size?: number; className?: string }>>)[name];
  return Cmp ? <Cmp size={size} /> : null;
}

export function Shell({ children, title, subtitle, actions }: { children: React.ReactNode; title: string; subtitle?: string; actions?: React.ReactNode }) {
  const { profile, loading, signOut, supabase } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    setMobileOpen(false);
    setNotifOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      router.replace("/login");
      return;
    }
    if (profile.role === "student" && pathname.startsWith("/dashboard")) router.replace("/me");
    // accounts created by an administrator start with a temporary password
    if (profile.must_change_password && pathname !== "/set-password") router.replace("/set-password");
  }, [loading, profile, router, pathname]);

  useEffect(() => {
    if (!profile) return;
    const load = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .or(`user_id.eq.${profile.id},and(user_id.is.null,role.eq.${profile.role})`)
        .order("created_at", { ascending: false })
        .limit(15);
      setNotifications((data as Notification[]) ?? []);
    };
    void load();
    const channel = supabase
      .channel("notif-stream")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, () => void load())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile, supabase]);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="relative flex h-12 w-12 items-center justify-center">
            <span className="absolute inset-0 rounded-2xl border border-mint-500/40 hp-ring" />
            <Activity className="text-mint-400" size={22} />
          </div>
          <p className="text-xs tracking-[0.25em] text-ink-400">HEALTHPLEX</p>
        </div>
      </div>
    );
  }

  if (!profile) return null;
  const nav = navFor(profile.role);
  const groups = Array.from(new Set(nav.map((n) => n.group)));
  const unread = notifications.filter((n) => !n.read_at).length;
  const home = ROLE_HOME[profile.role];

  const navLink = (item: NavItem) => {
    const active = pathname === item.href || (item.href !== home && pathname.startsWith(item.href + "/"));
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
          active ? "bg-mint-500/12 text-mint-300 shadow-[inset_0_0_0_1px_rgba(79,224,162,0.18)]" : "text-ink-400 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon name={item.icon} />
        <span className="truncate">{item.label}</span>
      </Link>
    );
  };

  const sidebar = (
    <div className="flex h-full flex-col">
      <Link href={home} className="flex items-center gap-2.5 px-4 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-mint-400 to-mint-600 text-navy-950 shadow-lg shadow-mint-600/20">
          <Activity size={19} strokeWidth={2.6} />
        </span>
        <span>
          <span className="block text-[15px] font-bold leading-none tracking-tight text-white">HEALTHPLEX</span>
          <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.16em] text-ink-400">GSFC University</span>
        </span>
      </Link>
      <nav className="flex-1 space-y-4 overflow-y-auto px-2 pb-4">
        {groups.map((g) => (
          <div key={g}>
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-400/70">{g}</p>
            <div className="space-y-0.5">{nav.filter((n) => n.group === g).map(navLink)}</div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/6 p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <Avatar name={profile.full_name} size={34} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-white">{profile.full_name}</p>
            <p className="truncate text-[11px] text-ink-400">{ROLE_LABEL[profile.role]}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-[248px] shrink-0 border-r border-white/6 bg-navy-950/60 backdrop-blur-xl lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button className="absolute inset-0 bg-navy-950/80 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close menu" />
          <div className="absolute left-0 top-0 h-full w-[268px] border-r border-white/8 bg-navy-900 hp-enter">
            <button className="absolute right-3 top-5 text-ink-400" onClick={() => setMobileOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
            {sidebar}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-white/6 bg-navy-950/70 px-4 py-3 backdrop-blur-xl md:px-6">
          <button className="text-ink-400 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold tracking-tight text-white">{title}</h1>
            {subtitle ? <p className="truncate text-[11.5px] text-ink-400">{subtitle}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-xl border border-white/8 bg-white/4 p-2 text-ink-400 transition-colors hover:text-white"
                aria-label="Notifications"
              >
                <Bell size={17} />
                {unread > 0 ? (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-mint-500 px-1 text-[9px] font-bold text-navy-950">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <Card className="absolute right-0 top-12 z-40 w-[320px] overflow-hidden p-0 hp-enter">
                  <div className="flex items-center justify-between border-b border-white/6 px-3.5 py-2.5">
                    <p className="text-xs font-semibold text-white">Notifications</p>
                    <span className="text-[10px] text-ink-400">{notifications.length} recent</span>
                  </div>
                  <div className="max-h-[340px] overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-3.5 py-8 text-center text-xs text-ink-400">No notifications yet</p>
                    ) : (
                      notifications.map((n) => (
                        <div key={n.id} className="border-b border-white/4 px-3.5 py-2.5 last:border-0">
                          <div className="flex items-start gap-2">
                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${n.severity === "critical" ? "bg-[#ff5e47]" : n.severity === "warning" ? "bg-warn-400" : n.severity === "success" ? "bg-mint-400" : "bg-sky-400"}`} />
                            <div className="min-w-0">
                              <p className="text-[12px] font-medium leading-snug text-white">{n.title}</p>
                              {n.body ? <p className="mt-0.5 line-clamp-2 text-[11px] text-ink-400">{n.body}</p> : null}
                              <p className="mt-1 text-[10px] text-ink-400/70">{timeAgo(n.created_at)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
              ) : null}
            </div>
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/4 py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-white/8"
              >
                <Avatar name={profile.full_name} size={26} />
                <ChevronDown size={14} className="text-ink-400" />
              </button>
              {menuOpen ? (
                <Card className="absolute right-0 top-11 z-40 w-[230px] p-1.5 hp-enter">
                  <div className="px-2.5 py-2">
                    <p className="truncate text-[13px] font-semibold text-white">{profile.full_name}</p>
                    <p className="truncate text-[11px] text-ink-400">{profile.email}</p>
                    <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-mint-500/12 px-2 py-0.5 text-[10px] font-semibold text-mint-300">
                      <ShieldCheck size={10} /> {ROLE_LABEL[profile.role]}
                    </span>
                  </div>
                  <div className="my-1 h-px bg-white/6" />
                  {profile.role === "student" ? (
                    <Link href="/me/profile" className="block rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-400 hover:bg-white/5 hover:text-white">
                      My profile
                    </Link>
                  ) : null}
                  <button
                    onClick={() => void signOut()}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-[#ffb2a1] hover:bg-[#ff5e47]/10"
                  >
                    <LogOut size={14} /> Sign out
                  </button>
                </Card>
              ) : null}
            </div>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">
          <div className="mx-auto w-full max-w-[1400px] hp-enter">{children}</div>
        </main>
        <footer className="border-t border-white/5 px-6 py-3 text-center text-[10.5px] text-ink-400/70">
          HEALTHPLEX · Smart University Gym Management System · GSFC University
        </footer>
      </div>
    </div>
  );
}
