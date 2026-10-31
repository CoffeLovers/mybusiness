CREATE TABLE "bank_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"provider" varchar(50) NOT NULL,
	"provider_item_id" varchar(255) NOT NULL,
	"access_token_ciphertext" text NOT NULL,
	"token_key_version" varchar(50) DEFAULT 'v1' NOT NULL,
	"institution_id" varchar(255),
	"institution_name" varchar(255),
	"environment" varchar(50) DEFAULT 'sandbox' NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"consented_products" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_successful_sync_at" timestamp with time zone,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bank_transaction_sync_state" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"last_synced_at" timestamp with time zone,
	"sync_offset" bigint DEFAULT 0,
	"initial_sync_complete" boolean DEFAULT false NOT NULL,
	"last_webhook_at" timestamp with time zone,
	"last_sync_started_at" timestamp with time zone,
	"last_sync_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider_transaction_id" varchar(255) NOT NULL,
	"amount" bigint NOT NULL,
	"iso_currency_code" varchar(3) DEFAULT 'USD' NOT NULL,
	"date" varchar(50) NOT NULL,
	"authorized_date" varchar(50),
	"name" varchar(500) NOT NULL,
	"merchant_name" varchar(255),
	"category" jsonb DEFAULT '[]'::jsonb,
	"pending" boolean DEFAULT false NOT NULL,
	"removed_at" timestamp with time zone,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_event_key" varchar(255) NOT NULL,
	"webhook_type" varchar(100) NOT NULL,
	"webhook_code" varchar(100),
	"connection_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" varchar(50) DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "connection_id" uuid;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "provider_account_id" varchar(255);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "name" varchar(255);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "official_name" varchar(255);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "type" varchar(100);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "subtype" varchar(100);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "mask" varchar(50);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "iso_currency_code" varchar(3);--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "balance_current" bigint;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "balance_available" bigint;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "status" varchar(50) DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD COLUMN "raw_metadata" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "bank_transaction_sync_state" ADD CONSTRAINT "bank_transaction_sync_state_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_id_bank_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_webhook_events" ADD CONSTRAINT "bank_webhook_events_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_connections_user_provider_status_idx" ON "bank_connections" USING btree ("user_id","provider","status");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_connections_provider_env_item_uq" ON "bank_connections" USING btree ("provider","environment","provider_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_account_provider_tx_uq" ON "bank_transactions" USING btree ("account_id","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_id_idx" ON "bank_transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_connection_id_idx" ON "bank_transactions" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_date_idx" ON "bank_transactions" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_webhook_events_provider_event_key_uq" ON "bank_webhook_events" USING btree ("provider","provider_event_key");--> statement-breakpoint
CREATE INDEX "bank_webhook_events_connection_id_idx" ON "bank_webhook_events" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "bank_webhook_events_processing_status_idx" ON "bank_webhook_events" USING btree ("processing_status");--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connection_id_bank_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."bank_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_connection_provider_account_uq" ON "bank_accounts" USING btree ("connection_id","provider_account_id");--> statement-breakpoint
CREATE INDEX "bank_accounts_connection_id_idx" ON "bank_accounts" USING btree ("connection_id");