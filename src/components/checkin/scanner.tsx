"use client";

import Link from "next/link";
import type QrScannerType from "qr-scanner";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { formatTime } from "@/lib/format";

type Result = "VALID" | "ALREADY_USED" | "INVALID" | "CANCELLED" | "REFUNDED" | "WRONG_EVENT";
interface Outcome {
  result: Result;
  ticket?: { code: string; holderName: string; typeName: string; checkedInAt: string | null };
}

const VIEW: Record<Result, { title: string; bg: string; icon: string }> = {
  VALID: { title: "ENTRADA LIBERADA", bg: "bg-emerald-600", icon: "✓" },
  ALREADY_USED: { title: "JÁ UTILIZADO", bg: "bg-amber-500", icon: "!" },
  INVALID: { title: "INVÁLIDO", bg: "bg-rose-600", icon: "✕" },
  CANCELLED: { title: "CANCELADO", bg: "bg-rose-600", icon: "✕" },
  REFUNDED: { title: "REEMBOLSADO", bg: "bg-rose-600", icon: "✕" },
  WRONG_EVENT: { title: "OUTRO EVENTO", bg: "bg-rose-600", icon: "✕" },
};

function deviceId() {
  try {
    let id = localStorage.getItem("na_device_id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("na_device_id", id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function Scanner({
  eventId,
  eventName,
  operator,
  initialStats,
}: {
  eventId: string;
  eventName: string;
  operator: string;
  initialStats: { checkedIn: number; total: number };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<QrScannerType | null>(null);
  const busy = useRef(false);
  const lastCode = useRef<{ value: string; at: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [count, setCount] = useState(initialStats.checkedIn);

  const submit = useCallback(
    async (qr: string) => {
      // Debounce: the same code kept in front of the camera must not be re-sent every frame.
      const now = Date.now();
      if (busy.current || (lastCode.current && lastCode.current.value === qr && now - lastCode.current.at < 4000)) return;
      busy.current = true;
      lastCode.current = { value: qr, at: now };
      setError(null);
      try {
        const res = await api<{ data: Outcome }>("/api/checkins", {
          method: "POST",
          body: JSON.stringify({ eventId, qr, deviceId: deviceId() }),
        });
        setOutcome(res.data);
        if (res.data.result === "VALID") setCount((c) => c + 1);
        navigator.vibrate?.(res.data.result === "VALID" ? 80 : [60, 60, 60]);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Falha de rede. Tente de novo.");
      } finally {
        busy.current = false;
      }
    },
    [eventId],
  );

  useEffect(() => {
    let disposed = false;
    (async () => {
      const { default: QrScanner } = await import("qr-scanner");
      if (disposed || !video.current) return;
      const s = new QrScanner(video.current, (r) => void submit(r.data), {
        preferredCamera: "environment",
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        returnDetailedScanResult: true,
      });
      scanner.current = s;
      try {
        await s.start();
      } catch {
        setCameraError("Não foi possível acessar a câmera. Libere a permissão ou use o código manual.");
      }
    })();
    return () => {
      disposed = true;
      scanner.current?.destroy();
      scanner.current = null;
    };
  }, [submit]);

  // Result overlay auto-clears so the operator can keep scanning.
  useEffect(() => {
    if (!outcome) return;
    const t = setTimeout(() => setOutcome(null), outcome.result === "VALID" ? 1800 : 3500);
    return () => clearTimeout(t);
  }, [outcome]);

  const v = outcome ? VIEW[outcome.result] : null;

  return (
    <main className="flex min-h-dvh flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 py-3 text-sm">
        <Link href="/checkin" className="text-white/70">← Eventos</Link>
        <span className="tabular font-semibold">{count} / {initialStats.total} entradas</span>
      </header>
      <p className="px-4 text-lg font-bold">{eventName}</p>
      <p className="px-4 text-xs text-white/50">Operador: {operator}</p>

      <div className="relative mx-4 mt-3 aspect-square overflow-hidden rounded-2xl bg-neutral-900">
        <video ref={video} className="size-full object-cover" muted playsInline />
        {cameraError && <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/80">{cameraError}</p>}
        {v && (
          <div className={`absolute inset-0 flex flex-col items-center justify-center p-6 text-center ${v.bg}`} role="alert" aria-live="assertive">
            <span className="text-7xl font-black">{v.icon}</span>
            <span className="mt-2 text-3xl font-black tracking-tight">{v.title}</span>
            {outcome?.ticket && (
              <>
                <span className="mt-3 text-xl font-semibold">{outcome.ticket.holderName}</span>
                <span className="text-sm opacity-90">{outcome.ticket.typeName} · {outcome.ticket.code}</span>
                {outcome.result === "ALREADY_USED" && outcome.ticket.checkedInAt && (
                  <span className="mt-2 text-sm">Entrada às {formatTime(outcome.ticket.checkedInAt)}</span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="mx-4 mt-3 rounded-lg bg-rose-900/60 p-3 text-sm">{error}</p>}

      <form
        className="mx-4 mt-4 flex gap-2 pb-8"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) void submit(manual.trim());
          setManual("");
        }}
      >
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Colar conteúdo do QR"
          className="min-w-0 flex-1 rounded-xl bg-neutral-800 px-4 py-3 text-white placeholder:text-white/40"
          autoComplete="off"
        />
        <button className="rounded-xl bg-white px-4 font-bold text-black">Validar</button>
      </form>
    </main>
  );
}
