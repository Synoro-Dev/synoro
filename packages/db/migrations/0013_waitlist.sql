CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"service_id" uuid,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"from_minute" smallint,
	"to_minute" smallint,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_entries_dates_ordered" CHECK ("waitlist_entries"."from_date" <= "waitlist_entries"."to_date"),
	CONSTRAINT "waitlist_entries_minutes_valid" CHECK (("waitlist_entries"."from_minute" is null or ("waitlist_entries"."from_minute" between 0 and 1410 and "waitlist_entries"."from_minute" % 30 = 0)) and ("waitlist_entries"."to_minute" is null or ("waitlist_entries"."to_minute" between 30 and 1440 and "waitlist_entries"."to_minute" % 30 = 0)) and ("waitlist_entries"."from_minute" is null or "waitlist_entries"."to_minute" is null or "waitlist_entries"."from_minute" < "waitlist_entries"."to_minute"))
);
--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "waitlist_entries_practice_idx" ON "waitlist_entries" USING btree ("practice_id","to_date");--> statement-breakpoint
CREATE INDEX "waitlist_entries_user_idx" ON "waitlist_entries" USING btree ("user_id");