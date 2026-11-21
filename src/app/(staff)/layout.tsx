import { AuthProvider } from "@/components/AuthProvider";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
