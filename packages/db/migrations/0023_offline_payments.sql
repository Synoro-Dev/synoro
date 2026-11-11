CREATE TYPE "public"."offline_payment_method" AS ENUM('cash', 'transfer', 'card', 'other');--> statement-breakpoint
ALTER TYPE "public"."archived_record_kind" ADD VALUE 'offline_payment';--> statement-breakpoint
CREATE TABLE "offline_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"member_id" uuid,
	"booking_id" uuid,
	"credit_entry_id" uuid,
	"amount" integer NOT NULL,
	"credits" smallint,
	"method" "offline_payment_method" NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"note" varchar(500),
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "offline_payments_amount_range" CHECK ("offline_payments"."amount" between 1 and 100000000)
);
--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_credit_entry_id_credit_entries_id_fk" FOREIGN KEY ("credit_entry_id") REFERENCES "public"."credit_entries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offline_payments" ADD CONSTRAINT "offline_payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "offline_payments_practice_paid_idx" ON "offline_payments" USING btree ("practice_id","paid_at");--> statement-breakpoint
CREATE INDEX "offline_payments_booking_idx" ON "offline_payments" USING btree ("booking_id");