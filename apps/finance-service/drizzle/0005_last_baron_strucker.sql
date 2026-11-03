CREATE TYPE "public"."reconciliation_match_status" AS ENUM('AUTO_MATCHED', 'NEEDS_REVIEW', 'MANUAL_MATCHED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_run_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_trigger" AS ENUM('MANUAL', 'NIGHTLY');--> statement-breakpoint
CREATE TABLE "reconciliation_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_transaction_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"invoice_id" uuid,
	"status" "reconciliation_match_status" DEFAULT 'NEEDS_REVIEW' NOT NULL,
	"score" numeric(4, 3) NOT NULL,
	"rule" varchar(100) NOT NULL,
	"evidence" jsonb NOT NULL,
	"matched_by" uuid,
	"matched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"trigger" "reconciliation_trigger" DEFAULT 'MANUAL' NOT NULL,
	"status" "reconciliation_run_status" DEFAULT 'RUNNING' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"processed" integer DEFAULT 0 NOT NULL,
	"auto_matched" integer DEFAULT 0 NOT NULL,
	"needs_review" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"date_window_days" integer DEFAULT 5 NOT NULL,
	"auto_match_threshold_bps" integer DEFAULT 8500 NOT NULL,
	"timezone" varchar(100) DEFAULT 'America/Bogota' NOT NULL,
	"lookback_days" integer DEFAULT 30 NOT NULL,
	"nightly_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "invoice_number" varchar(100);--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_bank_transaction_id_bank_transactions_id_fk" FOREIGN KEY ("bank_transaction_id") REFERENCES "public"."bank_transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_matches" ADD CONSTRAINT "reconciliation_matches_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_matches_tenant_tx_doc_uq" ON "reconciliation_matches" USING btree ("tenant_id","bank_transaction_id","document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_matches_active_tx_uq" ON "reconciliation_matches" USING btree ("tenant_id","bank_transaction_id") WHERE status IN ('AUTO_MATCHED', 'MANUAL_MATCHED');--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_matches_active_doc_uq" ON "reconciliation_matches" USING btree ("tenant_id","document_id") WHERE status IN ('AUTO_MATCHED', 'MANUAL_MATCHED');--> statement-breakpoint
CREATE INDEX "reconciliation_matches_tenant_status_idx" ON "reconciliation_matches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "reconciliation_matches_bank_tx_idx" ON "reconciliation_matches" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE INDEX "reconciliation_matches_doc_idx" ON "reconciliation_matches" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_tenant_idx" ON "reconciliation_runs" USING btree ("tenant_id","created_at");