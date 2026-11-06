CREATE TYPE "public"."archived_record_kind" AS ENUM('payment', 'credit_entry');--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'series';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'record';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'hours';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'package';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'message';--> statement-breakpoint
ALTER TYPE "public"."import_item_entity" ADD VALUE 'settings';--> statement-breakpoint
CREATE TABLE "archived_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"kind" "archived_record_kind" NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "booking_series" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "booking_series" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "archived_records" ADD CONSTRAINT "archived_records_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "archived_records_practice_idx" ON "archived_records" USING btree ("practice_id","kind");--> statement-breakpoint
ALTER TABLE "booking_series" ADD CONSTRAINT "booking_series_client_id_practice_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."practice_clients"("id") ON DELETE cascade ON UPDATE no action;