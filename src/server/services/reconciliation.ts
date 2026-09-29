/**
 * Reconciliation (phase 2): cross-checks orders ↔ payments ↔ PSP snapshots ↔ refunds ↔ webhooks
 * and records every divergence as a `reconciliation_issues` row (deduplicated per problem).
 *
 * Lifecycle: detected → OPEN. Re-detected → last_seen_at bumped (and details refreshed).
 * Condition gone → auto-RESOLVED ("auto"); if it comes back it is reopened.
 * A human can RESOLVE with a mandatory note (audited). That acknowledgement is sticky for the same
 * problem (e.g. a handled chargeback stays handled), but last_seen_at keeps showing it still exists.
 */
import { and, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { reconciliationIssues } from "@/server/db/schema";
import { audit } from "@/server/lib/audit";
import { AppError } from "@/server/lib/errors";
import { logger } from "@/server/lib/logger";

type Severity = "INFO" | "WARNING" | "CRITICAL";

interface Check {
  type: string;
  severity: Severity;
  label: string;
  entityType: string;
  /** Must return organization_id, entity_id and details (jsonb). */
  query: SQL;
}

export const CHECKS: Check[] = [
  {
    type: "ORDER_PAID_WITHOUT_PAYMENT",
    severity: "CRITICAL",
    label: "Pedido pago sem pagamento aprovado",
    entityType: "order",
    query: sql`
      SELECT o.organization_id, o.id::text AS entity_id,
             jsonb_build_object('code', o.code, 'status', o.status, 'total', o.total_amount) AS details
        FROM orders o
       WHERE o.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id
                          AND p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED','CHARGEBACK'))`,
  },
  {
    type: "PAYMENT_PAID_ORDER_NOT_PAID",
    severity: "CRITICAL",
    label: "Pagamento aprovado com pedido não pago (inclui pagamento tardio sem estoque)",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('orderCode', o.code, 'orderStatus', o.status, 'amount', p.amount,
                                'providerPaymentId', p.provider_payment_id) AS details
        FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.status IN ('PAID','PARTIALLY_REFUNDED')
         AND o.status NOT IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')`,
  },
  {
    type: "AMOUNT_MISMATCH",
    severity: "CRITICAL",
    label: "Diferença de valores (pedido × pagamento × PSP)",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('orderCode', o.code, 'orderTotal', o.total_amount, 'paymentAmount', p.amount,
                                'pspAmount', pt.amount, 'failureCode', p.failure_code) AS details
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN provider_transactions pt ON pt.payment_id = p.id AND pt.type = 'PAYMENT'
       WHERE p.failure_code = 'INTEGRITY_MISMATCH'
          OR (p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED') AND p.amount <> o.total_amount)
          OR (pt.amount IS NOT NULL AND pt.amount <> p.amount)`,
  },
  {
    type: "PSP_PAYMENT_WITHOUT_ORDER",
    severity: "CRITICAL",
    label: "Pagamento notificado pelo PSP sem pedido correspondente",
    entityType: "webhook_event",
    query: sql`
      SELECT NULL::uuid AS organization_id, w.id::text AS entity_id,
             jsonb_build_object('provider', w.provider, 'providerPaymentId', w.resource_id,
                                'attempts', w.attempts, 'lastError', w.last_error) AS details
        FROM webhook_events w
       WHERE w.resource_type = 'payment' AND w.status = 'FAILED'
         AND w.received_at < now() - interval '15 minutes'
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.provider = w.provider AND p.provider_payment_id = w.resource_id)`,
  },
  {
    type: "WEBHOOK_MISSING",
    severity: "WARNING",
    label: "Pagamento confirmado sem nenhum webhook recebido (só pelo job de sincronização)",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('provider', p.provider, 'providerPaymentId', p.provider_payment_id, 'paidAt', p.paid_at) AS details
        FROM payments p
       WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
         AND p.paid_at < now() - interval '30 minutes'
         AND NOT EXISTS (SELECT 1 FROM webhook_events w WHERE w.provider = p.provider AND w.resource_id = p.provider_payment_id)`,
  },
  {
    type: "WEBHOOK_PROCESSING_EXHAUSTED",
    severity: "CRITICAL",
    label: "Webhook falhou em todas as tentativas",
    entityType: "webhook_event",
    query: sql`
      SELECT NULL::uuid AS organization_id, w.id::text AS entity_id,
             jsonb_build_object('provider', w.provider, 'resourceId', w.resource_id, 'lastError', w.last_error) AS details
        FROM webhook_events w
       WHERE w.status = 'FAILED' AND w.next_attempt_at IS NULL`,
  },
  {
    type: "REFUND_DIVERGENCE",
    severity: "CRITICAL",
    label: "Reembolso divergente (refunds × pagamento × pedido)",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('orderCode', o.code, 'paymentRefunded', p.refunded_amount,
                                'orderRefunded', o.refunded_amount, 'refundsSucceeded', COALESCE(r.total, 0)) AS details
        FROM payments p
        JOIN orders o ON o.id = p.order_id
        LEFT JOIN (SELECT payment_id, SUM(amount)::int AS total FROM refunds WHERE status = 'SUCCEEDED' GROUP BY payment_id) r
               ON r.payment_id = p.id
       WHERE p.status IN ('PAID','PARTIALLY_REFUNDED','REFUNDED')
         AND (p.refunded_amount <> o.refunded_amount OR COALESCE(r.total, 0) <> p.refunded_amount)`,
  },
  {
    type: "REFUND_STUCK",
    severity: "WARNING",
    label: "Reembolso sem confirmação do PSP há mais de 1 hora",
    entityType: "refund",
    query: sql`
      SELECT r.organization_id, r.id::text AS entity_id,
             jsonb_build_object('status', r.status, 'amount', r.amount, 'createdAt', r.created_at) AS details
        FROM refunds r
       WHERE r.status IN ('REQUESTED','PROCESSING') AND r.created_at < now() - interval '1 hour'`,
  },
  {
    type: "REFUND_PENDING_ORDER",
    severity: "CRITICAL",
    label: "Pedido pago sem estoque aguardando reembolso",
    entityType: "order",
    query: sql`
      SELECT o.organization_id, o.id::text AS entity_id,
             jsonb_build_object('code', o.code, 'total', o.total_amount) AS details
        FROM orders o WHERE o.status = 'REFUND_PENDING'`,
  },
  {
    type: "PAYMENT_STUCK",
    severity: "WARNING",
    label: "Pagamento aberto há mais de 48 horas",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('status', p.status, 'provider', p.provider, 'providerPaymentId', p.provider_payment_id) AS details
        FROM payments p
       WHERE p.status IN ('PENDING','PROCESSING','AUTHORIZED') AND p.created_at < now() - interval '48 hours'`,
  },
  {
    type: "CHARGEBACK_OR_DISPUTE",
    severity: "CRITICAL",
    label: "Chargeback ou disputa aberta",
    entityType: "payment",
    query: sql`
      SELECT p.organization_id, p.id::text AS entity_id,
             jsonb_build_object('status', p.status, 'providerStatus', p.provider_status, 'amount', p.amount) AS details
        FROM payments p WHERE p.status = 'CHARGEBACK' OR p.disputed`,
  },
];

export const CHECK_LABELS = Object.fromEntries(CHECKS.map((c) => [c.type, c.label]));

export async function runReconciliation() {
  const db = getDb();
  const [{ started }] = (await db.execute<{ started: Date }>(sql`SELECT now() AS started`)).rows as [{ started: Date }];
  const counts: Record<string, number> = {};

  for (const check of CHECKS) {
    const rows = (await db.execute<{ organization_id: string | null; entity_id: string; details: Record<string, unknown> }>(check.query)).rows;
    counts[check.type] = rows.length;
    for (const r of rows) {
      await db
        .insert(reconciliationIssues)
        .values({
          organizationId: r.organization_id,
          type: check.type,
          severity: check.severity,
          dedupeKey: `${check.type}:${r.entity_id}`,
          entityType: check.entityType,
          entityId: r.entity_id,
          details: r.details,
        })
        .onConflictDoUpdate({
          target: reconciliationIssues.dedupeKey,
          set: {
            lastSeenAt: sql`now()`,
            details: r.details,
            // Reopen auto-resolved issues; keep human acknowledgements.
            status: sql`CASE WHEN ${reconciliationIssues.resolvedBy} IS NOT NULL THEN 'RESOLVED'::recon_issue_status ELSE 'OPEN'::recon_issue_status END`,
            resolvedAt: sql`CASE WHEN ${reconciliationIssues.resolvedBy} IS NOT NULL THEN ${reconciliationIssues.resolvedAt} ELSE NULL END`,
          },
        });
    }
  }

  // Conditions that disappeared are closed automatically.
  const autoResolved = await db
    .update(reconciliationIssues)
    .set({ status: "RESOLVED", resolvedAt: sql`now()`, resolutionNote: "auto: condição não detectada na última execução" })
    .where(and(eq(reconciliationIssues.status, "OPEN"), sql`${reconciliationIssues.lastSeenAt} < ${started}`))
    .returning({ id: reconciliationIssues.id });

  const open = Object.values(counts).reduce((a, b) => a + b, 0);
  if (open > 0) logger.warn("reconciliation.issues_open", { counts });
  return { open, autoResolved: autoResolved.length, counts };
}

export async function listIssues(opts: { orgIds: string[]; includePlatform: boolean; status?: "OPEN" | "RESOLVED"; limit?: number }) {
  const orgScope = opts.orgIds.length ? inArray(reconciliationIssues.organizationId, opts.orgIds) : sql`false`;
  // Issues without organization (unknown PSP payments, webhooks) are platform-level.
  const scope = opts.includePlatform ? or(isNull(reconciliationIssues.organizationId), orgScope) : orgScope;
  return getDb()
    .select()
    .from(reconciliationIssues)
    .where(and(scope, eq(reconciliationIssues.status, opts.status ?? "OPEN")))
    .orderBy(sql`CASE ${reconciliationIssues.severity} WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END`, desc(reconciliationIssues.detectedAt))
    .limit(opts.limit ?? 200);
}

export async function resolveIssue(issueId: string, note: string, actorUserId: string) {
  return getDb().transaction(async (tx) => {
    const [issue] = await tx
      .update(reconciliationIssues)
      .set({ status: "RESOLVED", resolvedAt: new Date(), resolvedBy: actorUserId, resolutionNote: note.slice(0, 500) })
      .where(and(eq(reconciliationIssues.id, issueId), eq(reconciliationIssues.status, "OPEN")))
      .returning();
    if (!issue) throw new AppError("NOT_FOUND", "Pendência não encontrada ou já resolvida.");
    await audit(tx, {
      action: "reconciliation.resolve",
      entityType: "reconciliation_issue",
      entityId: issue.id,
      organizationId: issue.organizationId,
      actorType: "USER",
      actorUserId,
      metadata: { type: issue.type, entityType: issue.entityType, entityId: issue.entityId, note },
    });
    return issue;
  });
}

export async function issueOrganizationId(issueId: string) {
  const i = await getDb().query.reconciliationIssues.findFirst({ where: eq(reconciliationIssues.id, issueId), columns: { organizationId: true } });
  return i === undefined ? undefined : i.organizationId;
}
