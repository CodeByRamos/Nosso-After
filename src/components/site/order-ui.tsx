"use client";

import { useEffect, useState } from "react";

export function StatusBox({ tone, title, text, children }: { tone: "ok" | "error" | "info"; title: string; text: string; children?: React.ReactNode }) {
  const cls = tone === "ok" ? "border-success/50 bg-success/10" : tone === "error" ? "border-danger/50 bg-danger/10" : "border-line bg-surface";
  return (
    <div className={`mt-6 border-2 p-5 ${cls}`} role="status">
      <p className="text-lg font-bold">{title}</p>
      <p className="mt-1 text-sm text-fg-2">{text}</p>
      {children}
    </div>
  );
}

export function Expiry({ expiresAt }: { expiresAt: string }) {
  const [left, setLeft] = useState(() => new Date(expiresAt).getTime() - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(new Date(expiresAt).getTime() - Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  const s = Math.max(0, Math.floor(left / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <p className="mt-4 text-center text-sm text-fg-2" aria-live="off">
      Reserva expira em <span className="tabular font-mono text-lg font-bold text-fg">{mm}:{ss}</span>
    </p>
  );
}
