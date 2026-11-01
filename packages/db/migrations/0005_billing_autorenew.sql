CREATE TYPE "public"."autorenewal_cancel_reason" AS ENUM('user', 'refund', 'charge_failed');--> statement-breakpoint
CREATE TYPE "public"."autorenewal_status" AS ENUM('active', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."decline_kind" AS ENUM('retry', 'final');--> statement-breakpoint
CREATE TABLE "subscription_autorenewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"period" "billing_period" NOT NULL,
	"status" "autorenewal_status" DEFAULT 'active' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"cancel_reason" "autorenewal_cancel_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "subscription_autorenewals_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "subscription_autorenewals_externalId_unique" UNIQUE("external_id")
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "autorenew_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "charged_for" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD COLUMN "decline_kind" "decline_kind";--> statement-breakpoint
ALTER TABLE "subscription_autorenewals" ADD CONSTRAINT "subscription_autorenewals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subscription_autorenewals_status_idx" ON "subscription_autorenewals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payments_user_charged_for_idx" ON "subscription_payments" USING btree ("user_id","charged_for");