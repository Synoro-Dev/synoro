ALTER TABLE "waitlist_entries" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD COLUMN "confirm_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_confirm_token_hash_unique" UNIQUE("confirm_token_hash");--> statement-breakpoint
-- Backfill: wishes made so far were taken as they came, before a visitor had to
-- confirm the email; they stay open (told as before) instead of silently going quiet.
UPDATE "waitlist_entries" SET "confirmed_at" = "created_at";
