CREATE TYPE "public"."context_type" AS ENUM('FINANCIAL_RULE', 'USER_PREFERENCE', 'CONVERSATION_SUMMARY', 'TRANSACTION_NOTE');--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"context_type" "context_type" DEFAULT 'CONVERSATION_SUMMARY' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_memories_embedding_hnsw_idx" ON "agent_memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "agent_memories_tenant_id_idx" ON "agent_memories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "agent_memories_tenant_context_idx" ON "agent_memories" USING btree ("tenant_id","context_type");--> statement-breakpoint
CREATE INDEX "agent_memories_user_id_idx" ON "agent_memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "agent_memories_created_at_idx" ON "agent_memories" USING btree ("created_at");