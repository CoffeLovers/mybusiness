CREATE TYPE "public"."document_status" AS ENUM('PENDING', 'PROCESSING', 'EXTRACTED', 'NEEDS_REVIEW', 'FAILED');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"original_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" varchar(64) NOT NULL,
	"storage_key" varchar(500) NOT NULL,
	"status" "document_status" DEFAULT 'PENDING' NOT NULL,
	"ocr_provider" varchar(50),
	"confidence" numeric(4, 3),
	"provider_name" varchar(255),
	"tax_id" varchar(50),
	"issue_date" date,
	"currency" varchar(3),
	"total_minor" bigint,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "document_id" uuid;--> statement-breakpoint
CREATE INDEX "documents_tenant_status_idx" ON "documents" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_tenant_checksum_uq" ON "documents" USING btree ("tenant_id","checksum_sha256");--> statement-breakpoint
CREATE INDEX "documents_tenant_created_at_idx" ON "documents" USING btree ("tenant_id","created_at");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_document_id_idx" ON "invoices" USING btree ("document_id");