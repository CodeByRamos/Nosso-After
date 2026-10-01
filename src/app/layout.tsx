import type { Metadata, Viewport } from "next";
import { Anton, Archivo } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton", display: "swap" });
// Archivo is variable in width and weight: one file covers condensed headlines, wide dates and body.
const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });

const appUrl = process.env.APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: { default: "Nosso After — O after de todas as festas", template: "%s · Nosso After" },
  description: "Nosso After, o after de todas as festas. A Nº1 do Guarujá. Ingressos oficiais com Pix ou cartão.",
  applicationName: "Nosso After",
  openGraph: { siteName: "Nosso After", locale: "pt_BR", type: "website" },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#050505",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Reading the request makes every page dynamic, which the nonce-based CSP requires
  // (a statically prerendered page would ship scripts without the per-request nonce).
  await headers();
  return (
    <html lang="pt-BR" className={`${anton.variable} ${archivo.variable}`}>
      <body className="min-h-dvh bg-bg text-fg antialiased">{children}</body>
    </html>
  );
}
