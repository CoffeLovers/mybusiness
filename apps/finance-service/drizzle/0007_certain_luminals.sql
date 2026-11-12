CREATE TYPE "public"."paypal_order_status" AS ENUM('CREATED', 'APPROVED', 'CAPTURED', 'FAILED', 'REFUNDED');--> statement-breakpoint
CREATE TABLE "paypal_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"status" "paypal_order_status" DEFAULT 'CREATED' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"paypal_order_id" varchar(255) NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"checkout_url" text NOT NULL,
	"provider_response" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paypal_orders" ADD CONSTRAINT "paypal_orders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_orders_tenant_idempotency_uq" ON "paypal_orders" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_orders_paypal_order_id_uq" ON "paypal_orders" USING btree ("paypal_order_id");--> statement-breakpoint
CREATE INDEX "paypal_orders_tenant_id_idx" ON "paypal_orders" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "paypal_orders_invoice_id_idx" ON "paypal_orders" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "paypal_orders_tenant_created_at_idx" ON "paypal_orders" USING btree ("tenant_id","created_at");