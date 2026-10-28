-- Hand-written (drizzle-kit can't express EXCLUDE): one practice can't have
-- two overlapping active bookings, so a time slot belongs to one client only.
-- It was in the old 0001_booking and got lost when the migrations were
-- squashed into 0000. Idempotent, so databases that kept it are fine.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
DO $$ BEGIN
 -- Preserve existing bookings and their credit/payment history. Conflicts must
 -- be reviewed under the normal cancellation/refund policy before migrating.
 -- Hold the lock through ALTER so no writer can introduce a new overlap.
 LOCK TABLE "bookings" IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS (
  SELECT 1 FROM "bookings" a JOIN "bookings" b
   ON a."practice_id" = b."practice_id" AND a."id" < b."id"
   AND tstzrange(a."starts_at", a."ends_at") && tstzrange(b."starts_at", b."ends_at")
  WHERE a."status" = 'active' AND b."status" = 'active'
 ) THEN
  RAISE EXCEPTION USING
   ERRCODE = '23P01',
   MESSAGE = 'Active bookings overlap; bookings_no_overlap cannot be applied',
   HINT = 'Review conflicting bookings and cancel/refund through the normal booking flow, then rerun the migration. No bookings were changed.';
 END IF;
 ALTER TABLE "bookings" ADD CONSTRAINT "bookings_no_overlap" EXCLUDE USING gist ("practice_id" WITH =, tstzrange("starts_at", "ends_at") WITH &&) WHERE ("status" = 'active');
EXCEPTION WHEN duplicate_object OR duplicate_table THEN null;
END $$;
