ALTER TABLE "sent_notices" ALTER COLUMN "sent_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "sent_notices" ALTER COLUMN "sent_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sent_notices" ADD COLUMN "claim_token" uuid;--> statement-breakpoint
ALTER TABLE "sent_notices" ADD COLUMN "claim_expires_at" timestamp with time zone;