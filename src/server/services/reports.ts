/**
 * CSV reports. Rows are fetched in keyset-paginated chunks and streamed, so a large event never
 * loads everything into memory. Hard cap per export to protect the database.
 */
import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";

export const REPORT_MAX_ROWS = 100_000;
const CHUNK = 1_000;

export type ReportType = "orders" | "sales-by-batch" | "promoters" | "checkins";
export const REPORT_TYPES: ReportType[] = ["orders", "sales-by-batch", "promoters", "checkins"];

export interface ReportFilter {
  organizationIds: string[];
  eventId?: string;
  from?: Date;
  to?: Date;
}

/**
 * CSV cell escaping, including formula-injection protection: values starting with = + - @ tab or CR
 * are prefixed with a quote so spreadsheet apps never execute buyer-provided text.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
const reais = (cents: unknown) => (Number(cents ?? 0) / 100).toFixed(2);

interface ReportDef {
  header: string[];
  /** Keyset-paginated query; `after` is the last cursor value (text) or null. */
  page: (f: ReportFilter, after: string | null) => SQL;
  row: (r: Record<string, unknown>) => unknown[];
}

const orgScope = (col: SQL, ids: string[]) =>
  ids.length ? sql`${col} IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})` : sql`false`;
const eventScope = (col: SQL, f: ReportFilter) => (f.eventId ? sql`AND ${col} = ${f.eventId}::uuid` : sql``);
const timeScope = (col: SQL, f: ReportFilter) =>
  sql`${f.from ? sql`AND ${col} >= ${f.from}` : sql``} ${f.to ? sql`AND ${col} < ${f.to}` : sql``}`;

const REPORTS: Record<ReportType, ReportDef> = {
  orders: {
    header: [
      "pedido", "status", "criado_em", "pago_em", "evento", "comprador", "email", "metodo",
      "subtotal", "desconto", "taxa_servico", "total", "reembolsado", "liquido_produtor",
      "cupom", "promoter", "comissao_promoter", "psp", "id_psp", "status_psp", "tarifa_psp",
    ],
    page: (f, after) => sql`
      SELECT o.id::text AS cursor, o.code, o.status, o.created_at, o.paid_at, e.name AS event_name,
             c.name AS customer_name, c.email, o.payment_method, o.subtotal_amount, o.discount_amount,
             o.fee_amount, o.total_amount, o.refunded_amount, o.promoter_commission_amount,
             cp.code AS coupon_code, pr.code AS promoter_code,
             p.provider, p.provider_payment_id, p.provider_status, p.provider_fee_amount
        FROM orders o
        JOIN events e ON e.id = o.event_id
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN coupons cp ON cp.id = o.coupon_id
        LEFT JOIN promoters pr ON pr.id = o.promoter_id
        LEFT JOIN LATERAL (SELECT * FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) p ON true
       WHERE ${orgScope(sql`o.organization_id`, f.organizationIds)} ${eventScope(sql`o.event_id`, f)}
             ${timeScope(sql`o.created_at`, f)}
             ${after ? sql`AND o.id > ${after}::uuid` : sql``}
       ORDER BY o.id LIMIT ${CHUNK}`,
    row: (r) => {
      const paid = r.paid_at !== null;
      const net = paid ? Number(r.total_amount) - Number(r.fee_amount) - Number(r.refunded_amount) : 0;
      return [
        r.code, r.status, r.created_at, r.paid_at, r.event_name, r.customer_name, r.email, r.payment_method,
        reais(r.subtotal_amount), reais(r.discount_amount), reais(r.fee_amount), reais(r.total_amount),
        reais(r.refunded_amount), reais(net), r.coupon_code, r.promoter_code, reais(r.promoter_commission_amount),
        r.provider, r.provider_payment_id, r.provider_status, r.provider_fee_amount === null ? "" : reais(r.provider_fee_amount),
      ];
    },
  },
  "sales-by-batch": {
    header: ["evento", "tipo", "lote", "preco", "capacidade", "vendidos", "reservados", "ingressos_validos", "check_ins", "receita_ingressos"],
    page: (f, after) => sql`
      SELECT b.id::text AS cursor, e.name AS event_name, tt.name AS type_name, b.name AS batch_name, b.price,
             b.quantity, b.sold_quantity, b.reserved_quantity,
             (SELECT count(*) FROM tickets t WHERE t.ticket_batch_id = b.id AND t.status IN ('VALID','CHECKED_IN')) AS valid_tickets,
             (SELECT count(*) FROM tickets t WHERE t.ticket_batch_id = b.id AND t.status = 'CHECKED_IN') AS checked_in,
             (SELECT COALESCE(SUM(oi.quantity * (oi.unit_price - oi.unit_discount)), 0)
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
               WHERE oi.ticket_batch_id = b.id AND o.status IN ('PAID','PARTIALLY_REFUNDED')) AS revenue
        FROM ticket_batches b
        JOIN events e ON e.id = b.event_id
        JOIN ticket_types tt ON tt.id = b.ticket_type_id
       WHERE ${orgScope(sql`e.organization_id`, f.organizationIds)} ${eventScope(sql`e.id`, f)}
             ${after ? sql`AND b.id > ${after}::uuid` : sql``}
       ORDER BY b.id LIMIT ${CHUNK}`,
    row: (r) => [r.event_name, r.type_name, r.batch_name, reais(r.price), r.quantity, r.sold_quantity, r.reserved_quantity, r.valid_tickets, r.checked_in, reais(r.revenue)],
  },
  promoters: {
    header: ["promoter", "codigo", "comissao_percentual", "comissao_fixa_ingresso", "pedidos_pagos", "receita_ingressos", "comissao_devida"],
    page: (f, after) => sql`
      SELECT pr.id::text AS cursor, pr.name, pr.code, pr.commission_bps, pr.commission_fixed_per_ticket,
             count(o.id) FILTER (WHERE o.status IN ('PAID','PARTIALLY_REFUNDED')) AS paid_orders,
             COALESCE(SUM(o.subtotal_amount - o.discount_amount) FILTER (WHERE o.status IN ('PAID','PARTIALLY_REFUNDED')), 0) AS revenue,
             COALESCE(SUM(CASE WHEN o.status = 'PAID' THEN o.promoter_commission_amount
                               WHEN o.status = 'PARTIALLY_REFUNDED' AND o.total_amount > 0
                                 THEN FLOOR(o.promoter_commission_amount::numeric * (o.total_amount - o.refunded_amount) / o.total_amount)
                               ELSE 0 END), 0) AS commission
        FROM promoters pr
        LEFT JOIN orders o ON o.promoter_id = pr.id ${f.eventId ? sql`AND o.event_id = ${f.eventId}::uuid` : sql``}
             ${f.from ? sql`AND o.paid_at >= ${f.from}` : sql``} ${f.to ? sql`AND o.paid_at < ${f.to}` : sql``}
       WHERE ${orgScope(sql`pr.organization_id`, f.organizationIds)} ${after ? sql`AND pr.id > ${after}::uuid` : sql``}
       GROUP BY pr.id ORDER BY pr.id LIMIT ${CHUNK}`,
    row: (r) => [r.name, r.code, (Number(r.commission_bps) / 100).toFixed(2), reais(r.commission_fixed_per_ticket), r.paid_orders, reais(r.revenue), reais(r.commission)],
  },
  checkins: {
    header: ["horario", "resultado", "evento", "ingresso", "titular", "operador", "dispositivo"],
    page: (f, after) => sql`
      SELECT ci.id::text AS cursor, ci.created_at, ci.result, e.name AS event_name, t.code AS ticket_code,
             t.holder_name, u.name AS operator_name, ci.device_id
        FROM check_ins ci
        JOIN events e ON e.id = ci.event_id
        LEFT JOIN tickets t ON t.id = ci.ticket_id
        LEFT JOIN users u ON u.id = ci.operator_user_id
       WHERE ${orgScope(sql`ci.organization_id`, f.organizationIds)} ${eventScope(sql`ci.event_id`, f)}
             ${timeScope(sql`ci.created_at`, f)} ${after ? sql`AND ci.id > ${after}::uuid` : sql``}
       ORDER BY ci.id LIMIT ${CHUNK}`,
    row: (r) => [r.created_at, r.result, r.event_name, r.ticket_code, r.holder_name, r.operator_name, r.device_id],
  },
};

/** Streams a CSV (UTF-8 with BOM so Excel opens accents correctly). */
export function streamReport(type: ReportType, filter: ReportFilter): ReadableStream<Uint8Array> {
  const def = REPORTS[type];
  const enc = new TextEncoder();
  let after: string | null = null;
  let sent = 0;
  let headerSent = false;
  return new ReadableStream({
    async pull(controller) {
      if (!headerSent) {
        controller.enqueue(enc.encode("﻿" + csvLine(def.header)));
        headerSent = true;
        return;
      }
      const rows = (await getDb().execute<Record<string, unknown>>(def.page(filter, after))).rows;
      if (rows.length === 0 || sent >= REPORT_MAX_ROWS) {
        controller.close();
        return;
      }
      after = String(rows[rows.length - 1]!.cursor);
      sent += rows.length;
      controller.enqueue(enc.encode(rows.map((r) => csvLine(def.row(r))).join("")));
      if (rows.length < CHUNK) controller.close();
    },
  });
}
