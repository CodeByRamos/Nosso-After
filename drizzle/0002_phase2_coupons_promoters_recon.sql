CREATE TYPE "public"."coupon_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."recon_issue_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."recon_severity" AS ENUM('INFO', 'WARNING', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."redemption_status" AS ENUM('RESERVED', 'CONFIRMED', 'RELEASED');--> statement-breakpoint
CREATE TABLE "coupon_batches" (
	"coupon_id" uuid NOT NULL,
	"ticket_batch_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"coupon_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"status" "redemption_status" DEFAULT 'RESERVED' NOT NULL,
	"discount_amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupon_redemptions_amount_ck" CHECK ("coupon_redemptions"."discount_amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid,
	"code" text NOT NULL,
	"description" text,
	"type" "coupon_type" NOT NULL,
	"value" integer NOT NULL,
	"max_redemptions" integer,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"per_customer_limit" integer DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coupons_code_ck" CHECK ("coupons"."code" ~ '^[A-Z0-9_-]{3,32}$'),
	CONSTRAINT "coupons_value_ck" CHECK ("coupons"."value" > 0 AND ("coupons"."type" <> 'PERCENTAGE' OR "coupons"."value" <= 10000)),
	CONSTRAINT "coupons_max_ck" CHECK ("coupons"."max_redemptions" IS NULL OR "coupons"."max_redemptions" > 0),
	CONSTRAINT "coupons_redeemed_ck" CHECK ("coupons"."redeemed_count" >= 0 AND ("coupons"."max_redemptions" IS NULL OR "coupons"."redeemed_count" <= "coupons"."max_redemptions")),
	CONSTRAINT "coupons_per_customer_ck" CHECK ("coupons"."per_customer_limit" BETWEEN 1 AND 100),
	CONSTRAINT "coupons_window_ck" CHECK ("coupons"."valid_until" IS NULL OR "coupons"."valid_until" > "coupons"."valid_from")
);
--> statement-breakpoint
CREATE TABLE "promoters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"commission_bps" integer DEFAULT 0 NOT NULL,
	"commission_fixed_per_ticket" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promoters_code_ck" CHECK ("promoters"."code" ~ '^[A-Z0-9_-]{3,32}$'),
	CONSTRAINT "promoters_commission_ck" CHECK ("promoters"."commission_bps" BETWEEN 0 AND 10000 AND "promoters"."commission_fixed_per_ticket" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"type" text NOT NULL,
	"severity" "recon_severity" NOT NULL,
	"dedupe_key" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "recon_issue_status" DEFAULT 'OPEN' NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"resolution_note" text
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_discount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "coupon_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promoter_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "promoter_commission_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "coupon_batches" ADD CONSTRAINT "coupon_batches_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_batches" ADD CONSTRAINT "coupon_batches_ticket_batch_id_ticket_batches_id_fk" FOREIGN KEY ("ticket_batch_id") REFERENCES "public"."ticket_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promoters" ADD CONSTRAINT "promoters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promoters" ADD CONSTRAINT "promoters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promoters" ADD CONSTRAINT "promoters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_issues" ADD CONSTRAINT "reconciliation_issues_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_batches_uq" ON "coupon_batches" USING btree ("coupon_id","ticket_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_order_uq" ON "coupon_redemptions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_customer_idx" ON "coupon_redemptions" USING btree ("coupon_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_org_code_uq" ON "coupons" USING btree ("organization_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "promoters_code_uq" ON "promoters" USING btree ("code");--> statement-breakpoint
CREATE INDEX "promoters_org_idx" ON "promoters" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "promoters_user_idx" ON "promoters" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "recon_dedupe_uq" ON "reconciliation_issues" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "recon_org_status_idx" ON "reconciliation_issues" USING btree ("organization_id","status","detected_at");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_promoter_id_promoters_id_fk" FOREIGN KEY ("promoter_id") REFERENCES "public"."promoters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_promoter_idx" ON "orders" USING btree ("promoter_id");--> statement-breakpoint
CREATE INDEX "orders_coupon_idx" ON "orders" USING btree ("coupon_id");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_discount_ck" CHECK ("order_items"."unit_discount" BETWEEN 0 AND "order_items"."unit_price");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_commission_ck" CHECK ("orders"."promoter_commission_amount" >= 0);