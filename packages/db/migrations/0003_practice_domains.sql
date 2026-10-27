CREATE TYPE "public"."practice_domain_status" AS ENUM('pending', 'active');--> statement-breakpoint
CREATE TABLE "practice_domains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"verification_token" text NOT NULL,
	"status" "practice_domain_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "practice_domains_practiceId_unique" UNIQUE("practice_id"),
	CONSTRAINT "practice_domains_hostname_unique" UNIQUE("hostname")
);
--> statement-breakpoint
ALTER TABLE "practice_domains" ADD CONSTRAINT "practice_domains_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;