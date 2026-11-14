CREATE TYPE "public"."practice_document_kind" AS ENUM('offer', 'informed_consent', 'personal_data', 'other');--> statement-breakpoint
ALTER TYPE "public"."archived_record_kind" ADD VALUE 'consent';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'document';--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"booking_id" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"by_session" boolean DEFAULT false NOT NULL,
	"ip" varchar(64),
	"user_agent" varchar(300),
	"representative_name" varchar(120),
	"minor_name" varchar(120)
);
--> statement-breakpoint
CREATE TABLE "practice_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"kind" "practice_document_kind" NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "practice_document_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_document_versions_number_unique" UNIQUE("document_id","number")
);
--> statement-breakpoint
ALTER TABLE "practices" ADD COLUMN "accepts_minors" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_member_id_practice_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."practice_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_version_id_practice_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."practice_document_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_documents" ADD CONSTRAINT "practice_documents_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_document_versions" ADD CONSTRAINT "practice_document_versions_document_id_practice_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."practice_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_member_version_idx" ON "consents" USING btree ("member_id","version_id");--> statement-breakpoint
CREATE INDEX "consents_practice_idx" ON "consents" USING btree ("practice_id");--> statement-breakpoint
CREATE INDEX "practice_documents_practice_idx" ON "practice_documents" USING btree ("practice_id");