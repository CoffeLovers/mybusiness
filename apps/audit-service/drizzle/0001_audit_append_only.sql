ALTER TABLE "audit_logs" ADD COLUMN "event_id" varchar(128);--> statement-breakpoint
CREATE UNIQUE INDEX "audit_logs_tenant_event_uq" ON "audit_logs" USING btree ("tenant_id","event_id");--> statement-breakpoint
CREATE TABLE "audit_dead_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"event_type" varchar(100) NOT NULL,
	"payload" jsonb NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"failed_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs" FOR EACH STATEMENT EXECUTE FUNCTION "prevent_audit_log_modification"();
