CREATE TABLE "standing_times" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"service_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"interval_weeks" smallint NOT NULL,
	"created_by_id" text,
	"paused_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "standing_times_interval" CHECK ("standing_times"."interval_weeks" in (1, 2))
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "standing_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "standing_slot" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "standing_times" ADD CONSTRAINT "standing_times_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_times" ADD CONSTRAINT "standing_times_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_times" ADD CONSTRAINT "standing_times_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "standing_times" ADD CONSTRAINT "standing_times_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "standing_times_member_idx" ON "standing_times" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "standing_times_practice_idx" ON "standing_times" USING btree ("practice_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_standing_id_standing_times_id_fk" FOREIGN KEY ("standing_id") REFERENCES "public"."standing_times"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_standing_slot_unique" UNIQUE("standing_id","standing_slot");