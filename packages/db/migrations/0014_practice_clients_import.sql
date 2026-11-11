CREATE TYPE "public"."import_item_action" AS ENUM('added', 'merged');--> statement-breakpoint
CREATE TYPE "public"."import_item_entity" AS ENUM('client', 'booking');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('table', 'calendar', 'archive');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('draft', 'applying', 'applied', 'failed', 'undone', 'expired');--> statement-breakpoint
CREATE TABLE "practice_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"phone" varchar(20),
	"email" text,
	"note" varchar(2000),
	"credits" integer DEFAULT 0 NOT NULL,
	"batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"created_by_id" text,
	"source" "import_source" NOT NULL,
	"status" "import_status" DEFAULT 'draft' NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"options" jsonb,
	"totals" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"applied_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_batch_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"batch_id" uuid NOT NULL,
	"entity" "import_item_entity" NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" "import_item_action" NOT NULL,
	"before" jsonb
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"content" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "practice_clients" ADD CONSTRAINT "practice_clients_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_clients" ADD CONSTRAINT "practice_clients_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_items" ADD CONSTRAINT "import_batch_items_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "practice_clients_practice_idx" ON "practice_clients" USING btree ("practice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "practice_clients_practice_phone_idx" ON "practice_clients" USING btree ("practice_id","phone") WHERE "practice_clients"."phone" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "practice_clients_practice_email_idx" ON "practice_clients" USING btree ("practice_id","email") WHERE "practice_clients"."email" is not null;--> statement-breakpoint
CREATE INDEX "import_batches_practice_created_idx" ON "import_batches" USING btree ("practice_id","created_at");--> statement-breakpoint
CREATE INDEX "import_batch_items_batch_idx" ON "import_batch_items" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "import_files_expires_idx" ON "import_files" USING btree ("expires_at");