"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatBRL } from "@/lib/format";

/** Single-series charts: one hue (darkened brand coral, ≥3:1 on white), recessive grid, hover tooltips. */
const MARK = "#e8492a";
const AXIS = { fontSize: 11, fill: "#78716c" };

function Empty() {
  return <p className="grid h-48 place-items-center text-sm text-stone-400">Sem dados no período.</p>;
}

function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { value: number }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  const v = payload[0]!.value;
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs shadow-sm">
      <p className="text-stone-500">{label}</p>
      <p className="tabular font-semibold text-stone-900">{money ? formatBRL(v) : v.toLocaleString("pt-BR")}</p>
    </div>
  );
}

export function BarSeries({
  data,
  x,
  y,
  money = false,
  height = 220,
}: {
  data: Record<string, string | number>[];
  x: string;
  y: string;
  money?: boolean;
  height?: number;
}) {
  if (data.length === 0) return <Empty />;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="#f0eeec" />
          <XAxis dataKey={x} tick={AXIS} tickLine={false} axisLine={{ stroke: "#e7e5e4" }} interval="preserveStartEnd" />
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={money ? 72 : 36}
            tickFormatter={(v: number) => (money ? formatBRL(v).replace(",00", "") : String(v))}
            allowDecimals={false}
          />
          <Tooltip cursor={{ fill: "#f5f5f4" }} content={<ChartTooltip money={money} />} />
          <Bar dataKey={y} fill={MARK} radius={[4, 4, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
