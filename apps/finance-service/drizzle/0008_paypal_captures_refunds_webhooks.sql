ALTER TABLE "paypal_orders" ADD COLUMN "capture_id" varchar(255);--> statement-breakpoint
ALTER TABLE "paypal_orders" ADD COLUMN "captured_amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "paypal_orders" ADD COLUMN "captured_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "paypal_orders" ADD COLUMN "refunded_amount_minor" bigint;--> statement-breakpoint
CREATE TABLE "paypal_refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"capture_id" varchar(255) NOT NULL,
	"paypal_refund_id" varchar(255) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" varchar(3) NOT NULL,
	"reason" varchar(255) NOT NULL,
	"requested_by" varchar(255) NOT NULL,
	"provider_status" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paypal_refunds" ADD CONSTRAINT "paypal_refunds_order_id_paypal_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."paypal_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "paypal_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" varchar(255) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"resource_id" varchar(255),
	"order_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"processing_status" varchar(32) NOT NULL,
	"error_message" varchar(500),
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paypal_webhook_events" ADD CONSTRAINT "paypal_webhook_events_order_id_paypal_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."paypal_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_orders_capture_id_uq" ON "paypal_orders" USING btree ("capture_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_refunds_paypal_refund_id_uq" ON "paypal_refunds" USING btree ("paypal_refund_id");--> statement-breakpoint
CREATE INDEX "paypal_refunds_tenant_id_idx" ON "paypal_refunds" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "paypal_refunds_order_id_idx" ON "paypal_refunds" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paypal_webhook_events_event_id_uq" ON "paypal_webhook_events" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "paypal_webhook_events_order_id_idx" ON "paypal_webhook_events" USING btree ("order_id");
