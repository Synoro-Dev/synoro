-- Idempotent (IF NOT EXISTS / duplicate guards) so `db:baseline` + `db:migrate`
-- also work on a database that was created with `db:push`.
DO $$ BEGIN
 CREATE TYPE "public"."booking_kind" AS ENUM('consultation', 'free', 'blocked');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."booking_status" AS ENUM('active', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."credit_reason" AS ENUM('purchase', 'booking', 'refund', 'adjustment');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."practice_member_role" AS ENUM('owner', 'admin', 'client');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_rules_weekday_range" CHECK ("availability_rules"."weekday" between 1 and 7),
	CONSTRAINT "availability_rules_minutes_valid" CHECK ("availability_rules"."start_minute" >= 0 and "availability_rules"."end_minute" <= 1440 and "availability_rules"."start_minute" < "availability_rules"."end_minute" and "availability_rules"."start_minute" % 30 = 0 and "availability_rules"."end_minute" % 30 = 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"kind" "booking_kind" NOT NULL,
	"status" "booking_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"member_id" uuid,
	"guest_name" varchar(120),
	"guest_contact" varchar(120),
	"note" varchar(500),
	"created_by_id" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "bookings_valid_range" CHECK ("bookings"."starts_at" < "bookings"."ends_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "credit_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"booking_id" uuid,
	"note" varchar(500),
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"slug" varchar(48) NOT NULL,
	"timezone" text DEFAULT 'Europe/Moscow' NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "practices_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "practice_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "practice_member_role" DEFAULT 'client' NOT NULL,
	"credits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "practice_members_practice_user_unique" UNIQUE("practice_id","user_id"),
	CONSTRAINT "practice_members_credits_non_negative" CHECK ("practice_members"."credits" >= 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practices" ADD CONSTRAINT "practices_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "availability_rules_practice_idx" ON "availability_rules" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_practice_starts_idx" ON "bookings" USING btree ("practice_id","starts_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bookings_member_idx" ON "bookings" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_entries_member_idx" ON "credit_entries" USING btree ("member_id");--> statement-breakpoint
-- Hand-written (drizzle-kit can't express EXCLUDE): one practice can't have
-- two overlapping active bookings, so a time slot belongs to one client only.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("practice_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
