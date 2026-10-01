ALTER TABLE "events" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "lineup" text;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "highlights" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_accent_ck" CHECK ("events"."accent_color" IS NULL OR "events"."accent_color" ~ '^#[0-9a-f]{6}$');