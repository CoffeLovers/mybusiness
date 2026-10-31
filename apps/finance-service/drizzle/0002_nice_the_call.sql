ALTER TABLE "bank_transactions" ADD COLUMN "transaction_type" "transaction_type" DEFAULT 'EXPENSE' NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_transactions" RENAME COLUMN "amount" TO "amount_minor";--> statement-breakpoint
ALTER TABLE "bank_transactions" ALTER COLUMN "transaction_type" DROP DEFAULT;
