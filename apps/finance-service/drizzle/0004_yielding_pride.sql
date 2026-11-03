ALTER TABLE "bank_webhook_events" ALTER COLUMN "processing_status" SET DEFAULT 'received';--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_webhook_events" ADD COLUMN "occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bank_webhook_events" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_webhook_events" ADD COLUMN "replay_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "bank_webhook_events_connection_occurred_idx" ON "bank_webhook_events" USING btree ("connection_id","occurred_at");--> statement-breakpoint
UPDATE "bank_webhook_events" SET "processing_status" = 'received' WHERE "processing_status" = 'pending';--> statement-breakpoint
UPDATE "bank_webhook_events" SET "occurred_at" = "received_at" WHERE "occurred_at" IS NULL;