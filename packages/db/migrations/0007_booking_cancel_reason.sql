CREATE TYPE "public"."booking_cancel_reason" AS ENUM('client', 'staff', 'no_show', 'hold_expired', 'payment_cancelled');--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancel_reason" "booking_cancel_reason";--> statement-breakpoint
-- Older cancellations, from what they left behind: an unpaid hold was
-- released by its cancelled payment or by time; a consultation cancelled by
-- its own client (or by the guest link, no user) was the client's; staff
-- cancelling a started consultation without a refund was a no-show; the rest
-- was staff.
UPDATE "bookings" AS b
SET "cancel_reason" = CASE
  WHEN b."hold_until" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "payments" p
    WHERE p."booking_id" = b."id" AND p."status" = 'canceled'
  ) THEN 'payment_cancelled'
  WHEN b."hold_until" IS NOT NULL THEN 'hold_expired'
  WHEN b."kind" = 'consultation' AND (
    b."cancelled_by_id" IS NULL OR b."cancelled_by_id" = (
      SELECT m."user_id" FROM "practice_members" m WHERE m."id" = b."member_id"
    )
  ) THEN 'client'
  WHEN b."kind" = 'consultation'
    AND b."cancelled_at" >= b."starts_at"
    AND NOT EXISTS (
      SELECT 1 FROM "credit_entries" c
      WHERE c."booking_id" = b."id" AND c."reason" = 'refund'
    ) THEN 'no_show'
  ELSE 'staff'
END::"booking_cancel_reason"
WHERE b."status" = 'cancelled';--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancel_reason" CHECK (("bookings"."status" = 'cancelled') = ("bookings"."cancel_reason" is not null));
