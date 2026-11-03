ALTER TABLE "agent_token_usage" ADD COLUMN "correlation_id" varchar(255);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_usage_tenant_correlation_uq" ON "agent_token_usage" USING btree ("tenant_id","correlation_id") WHERE "correlation_id" IS NOT NULL;
