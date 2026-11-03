CREATE TABLE "ledger_saved_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"query" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_saved_views_tenant_user_name_uq" ON "ledger_saved_views" USING btree ("tenant_id","user_id","name");--> statement-breakpoint
CREATE INDEX "ledger_saved_views_tenant_user_idx" ON "ledger_saved_views" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_date_idx" ON "bank_transactions" USING btree ("account_id","date");