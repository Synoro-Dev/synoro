ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "answers" jsonb;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN IF NOT EXISTS "booking_questions" jsonb DEFAULT '[]'::jsonb NOT NULL;
