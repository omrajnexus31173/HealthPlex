import { AuthProvider } from "@/components/AuthProvider";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
