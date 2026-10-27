CREATE TYPE "public"."payment_provider" AS ENUM('yookassa', 'tbank');--> statement-breakpoint
CREATE TYPE "public"."payment_tax_system" AS ENUM('osn', 'usn_income', 'usn_income_outcome', 'esn', 'patent');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'canceled');--> statement-breakpoint
CREATE TABLE "payment_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"merchant_id" varchar(64) NOT NULL,
	"secret" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"receipts" boolean DEFAULT false NOT NULL,
	"tax_system" "payment_tax_system",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "payment_accounts_practice_provider_unique" UNIQUE("practice_id","provider")
);
--> statement-breakpoint
CREATE TABLE "payment_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"credits" integer NOT NULL,
	"price" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_packages_practice_credits_unique" UNIQUE("practice_id","credits"),
	CONSTRAINT "payment_packages_credits_range" CHECK ("payment_packages"."credits" between 1 and 100),
	CONSTRAINT "payment_packages_price_positive" CHECK ("payment_packages"."price" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"member_id" uuid,
	"provider" "payment_provider" NOT NULL,
	"external_id" varchar(64),
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"credits" integer NOT NULL,
	"amount" integer NOT NULL,
	"confirmation_url" text,
	"created_by_id" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "payments_provider_external_unique" UNIQUE("provider","external_id"),
	CONSTRAINT "payments_positive" CHECK ("payments"."credits" > 0 and "payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_entries" ADD COLUMN "payment_id" uuid;--> statement-breakpoint
ALTER TABLE "payment_accounts" ADD CONSTRAINT "payment_accounts_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_packages" ADD CONSTRAINT "payment_packages_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_payment_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."payment_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_accounts_one_active_idx" ON "payment_accounts" USING btree ("practice_id") WHERE "payment_accounts"."active";--> statement-breakpoint
CREATE INDEX "payments_practice_created_idx" ON "payments" USING btree ("practice_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_member_idx" ON "payments" USING btree ("member_id");--> statement-breakpoint
ALTER TABLE "credit_entries" ADD CONSTRAINT "credit_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credit_entries_payment_idx" ON "credit_entries" USING btree ("payment_id");