import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "katex/dist/katex.min.css";
import "./globals.css";
import { HUDProvider } from "@/components/hud";

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
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <HUDProvider>
          {children}
        </HUDProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
