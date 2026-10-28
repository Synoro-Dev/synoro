CREATE TYPE "public"."billing_period" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"paid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "subscriptions_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"period" "billing_period" NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"external_id" varchar(64),
	"confirmation_url" text,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "subscription_payments_externalId_unique" UNIQUE("external_id"),
	CONSTRAINT "subscription_payments_positive" CHECK ("subscription_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_payments_user_created_idx" ON "subscription_payments" USING btree ("user_id","created_at");--> statement-breakpoint
-- Specialists who signed up while «Про» was free were promised it until
-- 1 January 2027 (Условия, п. 6.2): that date is their trial end.
INSERT INTO "subscriptions" ("user_id", "trial_ends_at")
SELECT DISTINCT "owner_id", timestamptz '2027-01-01 00:00:00+03'
FROM "practices"
ON CONFLICT ("user_id") DO NOTHING;
