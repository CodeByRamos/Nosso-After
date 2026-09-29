import { auditLogs } from "@/server/db/schema";
import type { DbOrTx } from "@/server/db/client";
import { currentLogContext, redact } from "./logger";

export type AuditAction =
  | "auth.login"
  | "auth.login_failed"
  | "auth.logout"
  | "organization.create"
  | "organization.update"
  | "event.create"
  | "event.update"
  | "event.status_change"
  | "batch.create"
  | "batch.update"
  | "fee_rule.create"
  | "fee_rule.update"
  | "order.create"
  | "order.paid"
  | "order.expired"
  | "order.cancel"
  | "order.refund_pending"
  | "payment.create"
  | "payment.status_change"
  | "refund.request"
  | "refund.succeeded"
  | "refund.failed"
  | "ticket.issue"
  | "ticket.invalidate"
  | "checkin.admit"
  | "manual.adjustment"
  | "coupon.create"
  | "coupon.update"
  | "promoter.create"
  | "promoter.update"
  | "reconciliation.resolve"
  | "member.create"
  | "member.update"
  | "customer.export"
  | "customer.anonymize"
  | "report.export"
  | "auth.password_change"
  | "auth.mfa_enable"
  | "auth.mfa_disable";

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  organizationId?: string | null;
  actorType: "USER" | "CUSTOMER" | "SYSTEM" | "PROVIDER";
  actorUserId?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown>;
}

/**
 * Appends to audit_logs (append-only; UPDATE/DELETE are rejected by a DB trigger).
 * Pass the transaction handle so the audit row commits atomically with the change it describes.
 */
export async function audit(db: DbOrTx, entry: AuditEntry) {
  const ctx = currentLogContext();
  await db.insert(auditLogs).values({
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    organizationId: entry.organizationId ?? null,
    actorType: entry.actorType,
    actorUserId: entry.actorUserId ?? (typeof ctx.user_id === "string" ? ctx.user_id : null),
    amount: entry.amount ?? null,
    metadata: (redact(entry.metadata ?? {}) as Record<string, unknown>) ?? {},
    ip: typeof ctx.ip === "string" && ctx.ip ? ctx.ip : null,
    userAgent: typeof ctx.user_agent === "string" ? ctx.user_agent.slice(0, 300) : null,
    requestId: typeof ctx.request_id === "string" ? ctx.request_id : null,
  });
}
