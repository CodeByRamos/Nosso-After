import type { Metadata, Viewport } from "next";
import { Anton, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Nosso After — Guarujá", template: "%s · Nosso After" },
  description: "Ingressos oficiais do Nosso After, no Guarujá/SP. Compra rápida com Pix ou cartão.",
  applicationName: "Nosso After",
  openGraph: { siteName: "Nosso After", locale: "pt_BR", type: "website" },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0a0b10",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request makes every page dynamic, which the nonce-based CSP requires
  // (a statically prerendered page would ship scripts without the per-request nonce).
  await headers();
  return (
    <html lang="pt-BR" className={`${anton.variable} ${inter.variable}`}>
      <body className="min-h-dvh bg-ink text-sand antialiased">{children}</body>
    </html>
  );
}
