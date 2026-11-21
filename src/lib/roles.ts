import type { user_role, account_status } from "./types";

export const ROLES: user_role[] = ["super_admin", "gym_admin", "gym_staff", "trainer", "student"];

export const ROLE_LABEL: Record<user_role, string> = {
  super_admin: "Super Admin",
  gym_admin: "Gym Admin",
  gym_staff: "Gym Staff",
  trainer: "Trainer",
  student: "Student",
};

export const STATUS_LABEL: Record<account_status, string> = {
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
  graduated: "Graduated",
};

/** Navigation with the minimum roles allowed to see each entry. */
export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: user_role[];
  group: "Overview" | "Attendance" | "People" | "Gym" | "System";
};

export const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard", roles: ["super_admin", "gym_admin", "gym_staff", "trainer"], group: "Overview" },
  { href: "/monitor", label: "Live Gym Monitor", icon: "Activity", roles: ["super_admin", "gym_admin", "gym_staff"], group: "Overview" },
  { href: "/kiosk", label: "Attendance Kiosk", icon: "ScanFace", roles: ["super_admin", "gym_admin", "gym_staff", "trainer"], group: "Attendance" },
  { href: "/attendance", label: "Attendance Records", icon: "ClipboardList", roles: ["super_admin", "gym_admin", "gym_staff", "trainer"], group: "Attendance" },
  { href: "/attendance/analytics", label: "Analytics & Reports", icon: "BarChart3", roles: ["super_admin", "gym_admin", "gym_staff"], group: "Attendance" },
  { href: "/students", label: "Students", icon: "Users", roles: ["super_admin", "gym_admin"], group: "People" },
  { href: "/staff", label: "Staff & Trainers", icon: "UserCog", roles: ["super_admin", "gym_admin"], group: "People" },
  { href: "/sessions", label: "Sessions & Schedule", icon: "CalendarClock", roles: ["super_admin", "gym_admin", "gym_staff", "trainer"], group: "Gym" },
  { href: "/equipment", label: "Equipment", icon: "Dumbbell", roles: ["super_admin", "gym_admin", "gym_staff", "trainer"], group: "Gym" },
  { href: "/settings", label: "Gym Settings", icon: "Settings", roles: ["super_admin", "gym_admin"], group: "System" },
  { href: "/security/kiosks", label: "Kiosk Devices", icon: "TabletSmartphone", roles: ["super_admin", "gym_admin"], group: "System" },
  { href: "/security/audit", label: "Audit Log", icon: "ScrollText", roles: ["super_admin", "gym_admin"], group: "System" },
  { href: "/retention", label: "Data Management", icon: "DatabaseZap", roles: ["super_admin"], group: "System" },
  // student space
  { href: "/me", label: "My Dashboard", icon: "LayoutDashboard", roles: ["student"], group: "Overview" },
  { href: "/me/attendance", label: "My Attendance", icon: "CalendarCheck", roles: ["student"], group: "Attendance" },
  { href: "/me/face", label: "Face Enrollment", icon: "ScanFace", roles: ["student"], group: "Attendance" },
  { href: "/me/sessions", label: "Sessions", icon: "CalendarClock", roles: ["student"], group: "Gym" },
  { href: "/me/profile", label: "My Profile", icon: "UserRound", roles: ["student"], group: "Gym" },
];

export function navFor(role: user_role): NavItem[] {
  return NAV.filter((n) => n.roles.includes(role));
}

export const ROLE_HOME: Record<user_role, string> = {
  super_admin: "/dashboard",
  gym_admin: "/dashboard",
  gym_staff: "/dashboard",
  trainer: "/dashboard",
  student: "/me",
};

export const STAFF_ROLES: user_role[] = ["super_admin", "gym_admin", "gym_staff", "trainer"];
export const ADMIN_ROLES: user_role[] = ["super_admin", "gym_admin"];

export function can(role: user_role | undefined | null, allowed: user_role[]): boolean {
  return !!role && allowed.includes(role);
}
