import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HEALTHPLEX · GSFC University Gym",
  description:
    "HEALTHPLEX — Smart University Gym Management System with face-recognition attendance for GSFC University.",
  applicationName: "HEALTHPLEX",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050b1c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
