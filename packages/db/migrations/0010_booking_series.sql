CREATE TABLE "booking_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"interval_weeks" smallint NOT NULL,
	"count" smallint NOT NULL,
	"created_by_id" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "booking_series_interval" CHECK ("booking_series"."interval_weeks" in (1, 2)),
	CONSTRAINT "booking_series_count" CHECK ("booking_series"."count" between 2 and 12)
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "series_id" uuid;--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_series_member_idx" ON "booking_series" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_series_id_booking_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."booking_series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookings_series_idx" ON "bookings" USING btree ("series_id");