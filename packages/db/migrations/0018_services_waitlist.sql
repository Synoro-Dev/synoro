CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"minutes" smallint DEFAULT 60 NOT NULL,
	"credits" smallint DEFAULT 1 NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "services_minutes_valid" CHECK ("services"."minutes" between 15 and 240 and "services"."minutes" % 5 = 0),
	CONSTRAINT "services_credits_range" CHECK ("services"."credits" between 1 and 10),
	CONSTRAINT "services_archived_inactive" CHECK ("services"."archived" = false or "services"."active" = false)
);
--> statement-breakpoint
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
ALTER TABLE "bookings" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "credits" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "services_practice_idx" ON "services" USING btree ("practice_id","position");--> statement-breakpoint
CREATE INDEX "waitlist_entries_practice_idx" ON "waitlist_entries" USING btree ("practice_id","to_date");--> statement-breakpoint
CREATE INDEX "waitlist_entries_user_idx" ON "waitlist_entries" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Backfill: every practice gets the one service it always had (an hour, one
-- credit, named in its profession's words), and the paid bookings made so far
-- point at it and keep their price of one credit — behaviour doesn't change.
INSERT INTO "services" ("practice_id", "name", "minutes", "credits", "position")
SELECT "id",
  CASE "profession"
    WHEN 'coach' THEN 'Сессия'
    WHEN 'tutor' THEN 'Занятие'
    WHEN 'trainer' THEN 'Тренировка'
    WHEN 'health' THEN 'Приём'
    WHEN 'other' THEN 'Встреча'
    ELSE 'Консультация'
  END,
  60, 1, 0
FROM "practices";--> statement-breakpoint
UPDATE "bookings"
SET "service_id" = (
      SELECT "services"."id" FROM "services"
      WHERE "services"."practice_id" = "bookings"."practice_id"
      ORDER BY "services"."position" LIMIT 1
    ),
    "credits" = 1
WHERE "kind" = 'consultation';
