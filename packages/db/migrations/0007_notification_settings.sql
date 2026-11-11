ALTER TABLE "practices" ADD COLUMN "remind_clients" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "notify_staff" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "daily_agenda" boolean DEFAULT true NOT NULL;