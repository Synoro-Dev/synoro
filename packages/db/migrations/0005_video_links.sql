ALTER TABLE "bookings" ADD COLUMN "meeting_url" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_day_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "reminder_hour_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "video_url" text;