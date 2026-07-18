import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import localFont from "next/font/local";

import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// App face: Space Grotesk — its squared-off geometric forms suit the flat,
// zero-radius shape language used across the dashboard.
const fontSans = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});
// Geist Mono stays for CIDs, peer IDs and other hashes — Space Grotesk isn't monospaced.
const fontMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
});
// Econome brand display face (weight 700 only) — brand wordmark/logo only. Body & UI use Space Grotesk.
const fontHeading = localFont({
  src: "./fonts/AntiqueOliveNord.woff",
  weight: "700",
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Econome — IPFS Storage Center",
  description: "Manage and monitor the Econome collaborative IPFS cluster.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${fontSans.variable} ${fontMono.variable} ${fontHeading.variable} font-sans antialiased`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
