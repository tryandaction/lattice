import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";
import { HUDProvider } from "@/components/hud/hud-provider";
import { ServiceWorkerRegister } from "@/components/pwa";

export const metadata: Metadata = {
  title: "Lattice 格致 - Scientific Workbench",
  description: "本地优先的科研工作台，专为论文阅读、笔记和代码编辑设计",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Lattice",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} antialiased`}
      >
        <HUDProvider>
          {children}
        </HUDProvider>
        <Toaster position="bottom-right" richColors />
        <ServiceWorkerRegister />
        {/* PWA 安装提示已禁用 */}
      </body>
    </html>
  );
}
