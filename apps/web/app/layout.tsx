import type { Metadata } from "next";
import localFont from "next/font/local";

import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const fontSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-sans",
});
const fontMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-mono",
});
// Econome brand display face (weight 700 only) — headings & logo. Body stays Geist.
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
