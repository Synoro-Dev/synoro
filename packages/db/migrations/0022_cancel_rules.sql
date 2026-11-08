ALTER TYPE "public"."booking_cancel_reason" ADD VALUE 'late_cancel' BEFORE 'hold_expired';--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "cancel_hours" smallint DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "late_cancel" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_cancel_hours" CHECK ("practices"."cancel_hours" in (3, 6, 12, 24, 48, 72));