ALTER TABLE "bookings" ADD COLUMN "guest_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "hold_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "access_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "booking_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_access_token_hash_unique" UNIQUE("access_token_hash");