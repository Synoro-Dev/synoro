CREATE TYPE "public"."data_audit_action" AS ENUM('access_confirmed', 'export_requested', 'export_downloaded', 'partial_export', 'feed_enabled', 'feed_rotated', 'feed_disabled', 'backup_enabled', 'backup_disabled', 'import_applied', 'import_undone', 'deletion_requested', 'deletion_cancelled');--> statement-breakpoint
CREATE TYPE "public"."data_export_kind" AS ENUM('full', 'weekly');--> statement-breakpoint
CREATE TYPE "public"."data_export_status" AS ENUM('pending', 'running', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "data_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"actor_id" text,
	"practice_id" uuid,
	"action" "data_audit_action" NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_feeds" (
	"practice_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"show_names" boolean DEFAULT false NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "client_backups" (
	"user_id" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_exports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"kind" "data_export_kind" NOT NULL,
	"status" "data_export_status" DEFAULT 'pending' NOT NULL,
	"file_key" text,
	"size_bytes" integer,
	"format_version" integer,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "data_audit_log" ADD CONSTRAINT "data_audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_audit_log" ADD CONSTRAINT "data_audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_audit_log" ADD CONSTRAINT "data_audit_log_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_backups" ADD CONSTRAINT "client_backups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_audit_log_user_created_idx" ON "data_audit_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_audit_log_created_idx" ON "data_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "data_exports_user_created_idx" ON "data_exports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "data_exports_status_expires_idx" ON "data_exports" USING btree ("status","expires_at");