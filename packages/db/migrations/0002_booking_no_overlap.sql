-- Hand-written (drizzle-kit can't express EXCLUDE): one practice can't have
-- two overlapping active bookings, so a time slot belongs to one client only.
-- It was in the old 0001_booking and got lost when the migrations were
-- squashed into 0000. Idempotent, so databases that kept it are fine.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("practice_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
