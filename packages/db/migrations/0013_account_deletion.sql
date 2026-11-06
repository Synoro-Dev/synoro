CREATE TABLE "account_deletions" (
	"user_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deletion_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practices" integer NOT NULL,
	"clients" integer NOT NULL,
	"bookings" integer NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserved_slugs" (
	"slug" varchar(48) PRIMARY KEY NOT NULL,
	"until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "slug_orders" DROP CONSTRAINT "slug_orders_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "slug_orders" DROP CONSTRAINT "slug_orders_practice_id_practices_id_fk";
--> statement-breakpoint
ALTER TABLE "subscription_payments" DROP CONSTRAINT "subscription_payments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "slug_orders" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "slug_orders" ALTER COLUMN "practice_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_payments" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "account_deletions" ADD CONSTRAINT "account_deletions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slug_orders" ADD CONSTRAINT "slug_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slug_orders" ADD CONSTRAINT "slug_orders_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;