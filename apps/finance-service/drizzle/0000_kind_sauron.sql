CREATE TYPE "public"."account_type" AS ENUM('CHECKING', 'SAVINGS', 'CREDIT', 'INVESTMENT');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('SYNCED', 'PENDING', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('PENDING', 'SETTLED', 'CANCELLED', 'RECONCILED');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('INCOME', 'EXPENSE', 'TRANSFER');--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"institution_name" varchar(255) NOT NULL,
	"institution_code" varchar(50),
	"account_type" "account_type" DEFAULT 'CHECKING' NOT NULL,
	"account_number_masked" varchar(50) NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"current_balance_minor" bigint DEFAULT 0 NOT NULL,
	"available_balance_minor" bigint DEFAULT 0 NOT NULL,
	"sync_status" "sync_status" DEFAULT 'SYNCED' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_number" varchar(100) NOT NULL,
	"counterparty_name" varchar(255) NOT NULL,
	"counterparty_tax_id" varchar(50) NOT NULL,
	"issue_date" timestamp with time zone DEFAULT now() NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"tax_amount_minor" bigint NOT NULL,
	"total_amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"status" "invoice_status" DEFAULT 'DRAFT' NOT NULL,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"associated_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) DEFAULT 'COP' NOT NULL,
	"type" "transaction_type" NOT NULL,
	"status" "transaction_status" DEFAULT 'PENDING' NOT NULL,
	"booking_date" timestamp with time zone DEFAULT now() NOT NULL,
	"description" varchar(500) NOT NULL,
	"category" varchar(100),
	"counterparty" jsonb DEFAULT '{}'::jsonb,
	"idempotency_key" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_associated_transaction_id_transactions_id_fk" FOREIGN KEY ("associated_transaction_id") REFERENCES "public"."transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_tenant_id_idx" ON "bank_accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_tenant_account_idx" ON "bank_accounts" USING btree ("tenant_id","account_number_masked");--> statement-breakpoint
CREATE INDEX "bank_accounts_deleted_at_idx" ON "bank_accounts" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_uq" ON "invoices" USING btree ("tenant_id","invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_id_idx" ON "invoices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "invoices_deleted_at_idx" ON "invoices" USING btree ("deleted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_tenant_idempotency_uq" ON "transactions" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "transactions_tenant_id_idx" ON "transactions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "transactions_bank_account_id_idx" ON "transactions" USING btree ("bank_account_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_booking_date_idx" ON "transactions" USING btree ("tenant_id","booking_date");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");