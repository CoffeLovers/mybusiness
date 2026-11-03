ALTER TYPE "public"."context_type" ADD VALUE IF NOT EXISTS 'DOCUMENT';--> statement-breakpoint
CREATE TABLE "agent_budget_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_key" varchar(7) NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_semantic_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"prompt_hash" varchar(64) NOT NULL,
	"prompt" text NOT NULL,
	"response" text NOT NULL,
	"prompt_embedding" vector(1536),
	"similarity_threshold" double precision DEFAULT 0.95 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_token_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_key" varchar(7) NOT NULL,
	"limit_micro_usd" bigint NOT NULL,
	"spent_micro_usd" bigint DEFAULT 0 NOT NULL,
	"reserved_micro_usd" bigint DEFAULT 0 NOT NULL,
	"warn_ratio" double precision DEFAULT 0.8 NOT NULL,
	"hard_limit" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_token_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correlation_id" varchar(255) NOT NULL,
	"estimated_cost_micro_usd" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" varchar(255),
	"model" varchar(100) NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint DEFAULT 0 NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"degraded" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_budget_events_tenant_period_event_uq" ON "agent_budget_events" USING btree ("tenant_id","period_key","event_type");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_semantic_cache_tenant_hash_uq" ON "agent_semantic_cache" USING btree ("tenant_id","prompt_hash");--> statement-breakpoint
CREATE INDEX "agent_semantic_cache_tenant_expires_idx" ON "agent_semantic_cache" USING btree ("tenant_id","expires_at");--> statement-breakpoint
CREATE INDEX "agent_semantic_cache_embedding_hnsw_idx" ON "agent_semantic_cache" USING hnsw ("prompt_embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_budgets_tenant_period_uq" ON "agent_token_budgets" USING btree ("tenant_id","period_key");--> statement-breakpoint
CREATE INDEX "agent_token_budgets_tenant_idx" ON "agent_token_budgets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_token_reservations_tenant_correlation_uq" ON "agent_token_reservations" USING btree ("tenant_id","correlation_id");--> statement-breakpoint
CREATE INDEX "agent_token_reservations_tenant_status_idx" ON "agent_token_reservations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "agent_token_usage_tenant_created_idx" ON "agent_token_usage" USING btree ("tenant_id","created_at");