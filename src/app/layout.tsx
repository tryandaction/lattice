import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "sonner";
import "katex/dist/katex.min.css";
import "./globals.css";
import { HUDProvider } from "@/components/hud";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Lattice 格致 - Scientific Workbench",
  description: "The Local-First, AI-Native Scientific Workbench",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <HUDProvider>
          {children}
        </HUDProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
