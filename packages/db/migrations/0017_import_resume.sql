ALTER TYPE "public"."data_audit_action" ADD VALUE 'feed_names_enabled' BEFORE 'backup_enabled';--> statement-breakpoint
ALTER TYPE "public"."data_audit_action" ADD VALUE 'feed_names_disabled' BEFORE 'backup_enabled';--> statement-breakpoint
ALTER TABLE "account_deletions" ADD COLUMN "cancel_bookings" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_items_source_idx" ON "import_batch_items" USING btree ("batch_id","source_key") WHERE "import_batch_items"."source_key" is not null;