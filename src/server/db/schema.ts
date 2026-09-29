/**
 * Relational schema (PostgreSQL) — single source of truth for migrations.
 *
 * Conventions (see DATABASE.md):
 *  - UUID primary keys (gen_random_uuid()).
 *  - Money in integer cents; percentages in basis points.
 *  - timestamptz everywhere; created_at/updated_at on mutable tables.
 *  - Every tenant-owned table carries organization_id (directly or via event).
 *  - CHECK constraints guard invariants the application also enforces.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const platformRole = pgEnum("platform_role", ["SUPER_ADMIN"]);
export const membershipRole = pgEnum("membership_role", [
  "ORGANIZATION_ADMIN",
  "EVENT_MANAGER",
  "CHECKIN_OPERATOR",
  "PROMOTER",
]);
export const userStatus = pgEnum("user_status", ["ACTIVE", "DISABLED"]);
export const organizationStatus = pgEnum("organization_status", ["ACTIVE", "SUSPENDED"]);

export const eventStatus = pgEnum("event_status", [
  "DRAFT",
  "PUBLISHED",
  "PAUSED",
  "SOLD_OUT",
  "FINISHED",
  "CANCELLED",
]);
export const batchStatus = pgEnum("batch_status", ["DRAFT", "ACTIVE", "PAUSED", "CLOSED"]);

export const paymentMethod = pgEnum("payment_method", ["PIX", "CREDIT_CARD"]);

export const orderStatus = pgEnum("order_status", [
  "AWAITING_PAYMENT",
  "PAID",
  "EXPIRED",
  "CANCELLED",
  "REFUND_PENDING",
  "PARTIALLY_REFUNDED",
  "REFUNDED",
]);
export const inventoryStatus = pgEnum("inventory_status", ["RESERVED", "COMMITTED", "RELEASED"]);

export const paymentStatus = pgEnum("payment_status", [
  "PENDING",
  "PROCESSING",
  "AUTHORIZED",
  "PAID",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
  "PARTIALLY_REFUNDED",
  "CHARGEBACK",
  "EXPIRED",
]);
export const paymentEnvironment = pgEnum("payment_environment", ["DEMO", "SANDBOX", "PRODUCTION"]);
export const attemptOperation = pgEnum("attempt_operation", ["CREATE", "GET", "CANCEL", "REFUND"]);
export const attemptOutcome = pgEnum("attempt_outcome", ["SUCCESS", "ERROR"]);
export const providerTxType = pgEnum("provider_tx_type", ["PAYMENT", "REFUND", "CHARGEBACK"]);

export const refundStatus = pgEnum("refund_status", ["REQUESTED", "PROCESSING", "SUCCEEDED", "FAILED"]);

export const feeType = pgEnum("fee_type", ["PLATFORM_FEE", "PROVIDER_FEE"]);
export const feeAppliesPer = pgEnum("fee_applies_per", ["TICKET", "ORDER"]);

export const ticketStatus = pgEnum("ticket_status", ["VALID", "CHECKED_IN", "CANCELLED", "REFUNDED"]);
export const checkInResult = pgEnum("check_in_result", [
  "VALID",
  "ALREADY_USED",
  "INVALID",
  "CANCELLED",
  "REFUNDED",
  "WRONG_EVENT",
]);

export const webhookStatus = pgEnum("webhook_status", [
  "RECEIVED",
  "PROCESSING",
  "PROCESSED",
  "FAILED",
  "IGNORED",
]);
export const idempotencyStatus = pgEnum("idempotency_status", ["IN_PROGRESS", "COMPLETED"]);
export const actorType = pgEnum("actor_type", ["USER", "CUSTOMER", "SYSTEM", "PROVIDER"]);
export const emailStatus = pgEnum("email_status", ["PENDING", "SENT", "FAILED"]);

// ---------------------------------------------------------------------------
// Identity & tenancy
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    legalName: text("legal_name"),
    /** CNPJ/CPF of the producer — needed for fiscal/PSP onboarding. */
    document: text("document"),
    contactEmail: text("contact_email"),
    status: organizationStatus("status").notNull().default("ACTIVE"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [uniqueIndex("organizations_slug_uq").on(t.slug)],
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    platformRole: platformRole("platform_role"),
    status: userStatus("status").notNull().default("ACTIVE"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: ts("locked_until"),
    lastLoginAt: ts("last_login_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("users_email_uq").on(sql`lower(${t.email})`),
    check("users_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("memberships_user_org_uq").on(t.userId, t.organizationId),
    index("memberships_org_idx").on(t.organizationId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the opaque session token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: ts("expires_at").notNull(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    revokedAt: ts("revoked_at"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_uq").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

// ---------------------------------------------------------------------------
// Events & inventory
// ---------------------------------------------------------------------------

export const venues = pgTable(
  "venues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    addressLine: text("address_line"),
    neighborhood: text("neighborhood"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code"),
    mapsUrl: text("maps_url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("venues_org_idx").on(t.organizationId)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    venueId: uuid("venue_id").references(() => venues.id),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    coverImageUrl: text("cover_image_url"),
    status: eventStatus("status").notNull().default("DRAFT"),
    startsAt: ts("starts_at").notNull(),
    endsAt: ts("ends_at").notNull(),
    salesStartAt: ts("sales_start_at"),
    salesEndAt: ts("sales_end_at"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    ageRating: text("age_rating"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    uniqueIndex("events_slug_uq").on(t.slug),
    index("events_org_idx").on(t.organizationId),
    index("events_status_starts_idx").on(t.status, t.startsAt),
    check("events_dates_ck", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "events_sales_window_ck",
      sql`${t.salesStartAt} IS NULL OR ${t.salesEndAt} IS NULL OR ${t.salesEndAt} > ${t.salesStartAt}`,
    ),
  ],
);

export const ticketTypes = pgTable(
  "ticket_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ticket_types_event_idx").on(t.eventId)],
);

export const ticketBatches = pgTable(
  "ticket_batches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    name: text("name").notNull(),
    /** Unit price in cents. */
    price: integer("price").notNull(),
    quantity: integer("quantity").notNull(),
    soldQuantity: integer("sold_quantity").notNull().default(0),
    reservedQuantity: integer("reserved_quantity").notNull().default(0),
    salesStart: ts("sales_start"),
    salesEnd: ts("sales_end"),
    maxPerCustomer: integer("max_per_customer").notNull().default(10),
    status: batchStatus("status").notNull().default("DRAFT"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("ticket_batches_event_idx").on(t.eventId, t.sortOrder),
    check("ticket_batches_price_ck", sql`${t.price} >= 0`),
    check("ticket_batches_quantity_ck", sql`${t.quantity} >= 0`),
    check("ticket_batches_sold_ck", sql`${t.soldQuantity} >= 0`),
    check("ticket_batches_reserved_ck", sql`${t.reservedQuantity} >= 0`),
    // The anti-overselling invariant. Enforced by the database, not only by code.
    check(
      "ticket_batches_capacity_ck",
      sql`${t.soldQuantity} + ${t.reservedQuantity} <= ${t.quantity}`,
    ),
    check("ticket_batches_max_per_customer_ck", sql`${t.maxPerCustomer} BETWEEN 1 AND 100`),
  ],
);

// ---------------------------------------------------------------------------
// Customers & orders
// ---------------------------------------------------------------------------

export const customers = pgTable(
  "customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    /** CPF digits only. Required by the PSP for card/Pix payer identification. */
    document: text("document"),
    marketingOptIn: boolean("marketing_opt_in").notNull().default(false),
    anonymizedAt: ts("anonymized_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("customers_org_email_uq").on(t.organizationId, t.email),
    check("customers_email_lower_ck", sql`${t.email} = lower(${t.email})`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short human-friendly reference (shown to buyer / support). */
    code: text("code").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: orderStatus("status").notNull().default("AWAITING_PAYMENT"),
    inventoryStatus: inventoryStatus("inventory_status").notNull().default("RESERVED"),
    paymentMethod: paymentMethod("payment_method").notNull(),
    currency: text("currency").notNull().default("BRL"),
    subtotalAmount: integer("subtotal_amount").notNull(),
    discountAmount: integer("discount_amount").notNull().default(0),
    feeAmount: integer("fee_amount").notNull(),
    totalAmount: integer("total_amount").notNull(),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    expiresAt: ts("expires_at").notNull(),
    paidAt: ts("paid_at"),
    cancelledAt: ts("cancelled_at"),
    /** Stored for fraud analysis only; purged by the retention job. */
    ip: inet("ip"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("orders_code_uq").on(t.code),
    index("orders_org_created_idx").on(t.organizationId, t.createdAt),
    index("orders_event_status_idx").on(t.eventId, t.status),
    index("orders_customer_idx").on(t.customerId),
    index("orders_expiry_idx")
      .on(t.expiresAt)
      .where(sql`${t.status} = 'AWAITING_PAYMENT'`),
    check("orders_amounts_nonneg_ck", sql`${t.subtotalAmount} >= 0 AND ${t.discountAmount} >= 0 AND ${t.feeAmount} >= 0`),
    check(
      "orders_total_ck",
      sql`${t.totalAmount} = ${t.subtotalAmount} - ${t.discountAmount} + ${t.feeAmount}`,
    ),
    check("orders_refunded_ck", sql`${t.refundedAmount} BETWEEN 0 AND ${t.totalAmount}`),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    ticketBatchId: uuid("ticket_batch_id")
      .notNull()
      .references(() => ticketBatches.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    quantity: integer("quantity").notNull(),
    unitPrice: integer("unit_price").notNull(),
    unitFee: integer("unit_fee").notNull(),
    /** Snapshot for receipts: batch and type names at purchase time. */
    description: text("description").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_batch_idx").on(t.ticketBatchId),
    check("order_items_quantity_ck", sql`${t.quantity} > 0`),
    check("order_items_amounts_ck", sql`${t.unitPrice} >= 0 AND ${t.unitFee} >= 0`),
  ],
);

/** Append-only timeline of an order (ORDER_CREATED, INVENTORY_RESERVED, PAYMENT_APPROVED…). */
export const orderEvents = pgTable(
  "order_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    type: text("type").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId, t.id)],
);

// ---------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------

export const feeRules = pgTable(
  "fee_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Null = applies to all organizations. */
    organizationId: uuid("organization_id").references(() => organizations.id),
    /** Null = applies to all events of the scope. */
    eventId: uuid("event_id").references(() => events.id),
    /** Null = applies to any payment method. */
    paymentMethod: paymentMethod("payment_method"),
    appliesPer: feeAppliesPer("applies_per").notNull().default("TICKET"),
    fixedAmount: integer("fixed_amount").notNull().default(0),
    percentageBps: integer("percentage_bps").notNull().default(0),
    priority: integer("priority").notNull().default(0),
    activeFrom: ts("active_from").notNull().defaultNow(),
    activeUntil: ts("active_until"),
    isActive: boolean("is_active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("fee_rules_scope_idx").on(t.organizationId, t.eventId),
    check("fee_rules_fixed_ck", sql`${t.fixedAmount} >= 0`),
    check("fee_rules_pct_ck", sql`${t.percentageBps} BETWEEN 0 AND 10000`),
    check(
      "fee_rules_window_ck",
      sql`${t.activeUntil} IS NULL OR ${t.activeUntil} > ${t.activeFrom}`,
    ),
  ],
);

export const fees = pgTable(
  "fees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid("order_item_id").references(() => orderItems.id),
    paymentId: uuid("payment_id"),
    feeRuleId: uuid("fee_rule_id").references(() => feeRules.id),
    type: feeType("type").notNull(),
    amount: integer("amount").notNull(),
    /** Snapshot of the rule parameters used (fixed, bps, applies_per). */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("fees_order_idx").on(t.orderId),
    check("fees_amount_ck", sql`${t.amount} >= 0`),
  ],
);

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    provider: text("provider").notNull(),
    environment: paymentEnvironment("environment").notNull(),
    method: paymentMethod("method").notNull(),
    status: paymentStatus("status").notNull().default("PENDING"),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("BRL"),
    installments: integer("installments").notNull().default(1),
    providerPaymentId: text("provider_payment_id"),
    providerStatus: text("provider_status"),
    providerStatusDetail: text("provider_status_detail"),
    /** Pix "copia e cola" (EMV payload). Not sensitive: it is what the buyer shares with their bank. */
    pixQrCode: text("pix_qr_code"),
    pixExpiresAt: ts("pix_expires_at"),
    /** PCI allows storing brand + last 4 digits. PAN/CVV are never received by this system. */
    cardBrand: text("card_brand"),
    cardLastFour: text("card_last_four"),
    /** Platform commission sent to the PSP split (application_fee), when split is enabled. */
    applicationFeeAmount: integer("application_fee_amount"),
    /** PSP processing cost as reported by the PSP. */
    providerFeeAmount: integer("provider_fee_amount"),
    netAmount: integer("net_amount"),
    refundedAmount: integer("refunded_amount").notNull().default(0),
    disputed: boolean("disputed").notNull().default(false),
    authorizedAt: ts("authorized_at"),
    paidAt: ts("paid_at"),
    failedAt: ts("failed_at"),
    failureCode: text("failure_code"),
    failureMessage: text("failure_message"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("payments_provider_payment_uq").on(t.provider, t.providerPaymentId),
    index("payments_order_idx").on(t.orderId),
    index("payments_org_created_idx").on(t.organizationId, t.createdAt),
    index("payments_status_idx").on(t.status, t.updatedAt),
    // At most one live payment per order: prevents double charging.
    uniqueIndex("payments_one_active_per_order_uq")
      .on(t.orderId)
      .where(sql`${t.status} IN ('PENDING','PROCESSING','AUTHORIZED','PAID')`),
    check("payments_amount_ck", sql`${t.amount} > 0`),
    check("payments_refunded_ck", sql`${t.refundedAmount} BETWEEN 0 AND ${t.amount}`),
    check("payments_installments_ck", sql`${t.installments} BETWEEN 1 AND 24`),
    check("payments_last_four_ck", sql`${t.cardLastFour} IS NULL OR ${t.cardLastFour} ~ '^[0-9]{4}$'`),
  ],
);

/** Every call we make to the PSP (create/get/cancel/refund) — sanitized, for audit & debugging. */
export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").references(() => payments.id),
    refundId: uuid("refund_id"),
    provider: text("provider").notNull(),
    operation: attemptOperation("operation").notNull(),
    outcome: attemptOutcome("outcome").notNull(),
    idempotencyKey: text("idempotency_key"),
    providerReference: text("provider_reference"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [index("payment_attempts_payment_idx").on(t.paymentId, t.createdAt)],
);

/** Latest known snapshot of each PSP-side object (payment/refund/chargeback) for reconciliation. */
export const providerTransactions = pgTable(
  "provider_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    type: providerTxType("type").notNull(),
    providerTransactionId: text("provider_transaction_id").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    rawStatus: text("raw_status").notNull(),
    amount: integer("amount").notNull(),
    /** Sanitized subset of the PSP object. Never contains card data. */
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("provider_tx_uq").on(t.provider, t.type, t.providerTransactionId),
    index("provider_tx_payment_idx").on(t.paymentId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("REQUESTED"),
    providerRefundId: text("provider_refund_id"),
    requestedBy: uuid("requested_by").references(() => users.id),
    failureMessage: text("failure_message"),
    completedAt: ts("completed_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("refunds_payment_idx").on(t.paymentId),
    index("refunds_org_created_idx").on(t.organizationId, t.createdAt),
    uniqueIndex("refunds_provider_uq").on(t.paymentId, t.providerRefundId),
    // One refund in flight per payment at a time.
    uniqueIndex("refunds_one_inflight_uq")
      .on(t.paymentId)
      .where(sql`${t.status} IN ('REQUESTED','PROCESSING')`),
    check("refunds_amount_ck", sql`${t.amount} > 0`),
  ],
);

// ---------------------------------------------------------------------------
// Tickets & check-in
// ---------------------------------------------------------------------------

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    orderItemId: uuid("order_item_id")
      .notNull()
      .references(() => orderItems.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketTypeId: uuid("ticket_type_id")
      .notNull()
      .references(() => ticketTypes.id),
    ticketBatchId: uuid("ticket_batch_id")
      .notNull()
      .references(() => ticketBatches.id),
    holderName: text("holder_name").notNull(),
    holderEmail: text("holder_email").notNull(),
    /** Bumped on re-issue; old QR payloads stop validating. */
    qrVersion: integer("qr_version").notNull().default(1),
    status: ticketStatus("status").notNull().default("VALID"),
    issuedAt: ts("issued_at").notNull().defaultNow(),
    checkedInAt: ts("checked_in_at"),
    cancelledAt: ts("cancelled_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tickets_code_uq").on(t.code),
    index("tickets_order_idx").on(t.orderId),
    index("tickets_event_status_idx").on(t.eventId, t.status),
    check(
      "tickets_checkin_ck",
      sql`(${t.status} = 'CHECKED_IN') = (${t.checkedInAt} IS NOT NULL)`,
    ),
  ],
);

export const checkIns = pgTable(
  "check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    ticketId: uuid("ticket_id").references(() => tickets.id),
    result: checkInResult("result").notNull(),
    operatorUserId: uuid("operator_user_id").references(() => users.id),
    sessionId: uuid("session_id"),
    deviceId: text("device_id"),
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("check_ins_event_created_idx").on(t.eventId, t.createdAt),
    index("check_ins_ticket_idx").on(t.ticketId),
    // Database-level guarantee: a ticket can only be admitted once.
    uniqueIndex("check_ins_one_valid_per_ticket_uq")
      .on(t.ticketId)
      .where(sql`${t.result} = 'VALID'`),
  ],
);

// ---------------------------------------------------------------------------
// Infrastructure tables
// ---------------------------------------------------------------------------

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    /** Provider-unique delivery identity used to drop duplicates. */
    dedupeKey: text("dedupe_key").notNull(),
    eventType: text("event_type").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: webhookStatus("status").notNull().default("RECEIVED"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at"),
    lastError: text("last_error"),
    requestId: text("request_id"),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("webhook_events_dedupe_uq").on(t.provider, t.dedupeKey),
    index("webhook_events_retry_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'FAILED'`),
    index("webhook_events_resource_idx").on(t.provider, t.resourceId),
  ],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Endpoint + principal, e.g. "POST /api/orders". */
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    requestHash: text("request_hash").notNull(),
    status: idempotencyStatus("status").notNull().default("IN_PROGRESS"),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    lockedUntil: ts("locked_until").notNull(),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_scope_key_uq").on(t.scope, t.key),
    index("idempotency_expires_idx").on(t.expiresAt),
  ],
);

/** Append-only (UPDATE/DELETE blocked by trigger — see migration). */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    organizationId: uuid("organization_id"),
    actorType: actorType("actor_type").notNull(),
    actorUserId: uuid("actor_user_id"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    amount: integer("amount"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    requestId: text("request_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull(),
});

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    toEmail: text("to_email").notNull(),
    template: text("template").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: emailStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Idempotency: one email per (template, entity). */
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: createdAt(),
    sentAt: ts("sent_at"),
  },
  (t) => [
    uniqueIndex("email_outbox_dedupe_uq").on(t.dedupeKey),
    index("email_outbox_pending_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
  ],
);

/**
 * State of the local DEMO payment simulator ("mock" provider).
 * Conceptually this is the simulated PSP's own database; the core never reads it directly.
 */
export const mockPspTransactions = pgTable("mock_psp_transactions", {
  id: text("id").primaryKey(),
  method: paymentMethod("method").notNull(),
  status: text("status").notNull(),
  statusDetail: text("status_detail"),
  amount: integer("amount").notNull(),
  refundedAmount: integer("refunded_amount").notNull().default(0),
  externalReference: text("external_reference").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  cardScenario: text("card_scenario"),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
