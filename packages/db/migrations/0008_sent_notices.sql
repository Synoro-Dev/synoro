CREATE TABLE "sent_notices" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"sent_at" timestamp with time zone,
	"claim_token" uuid,
	"claim_expires_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sent_notices" ADD CONSTRAINT "sent_notices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sent_notices_user_idx" ON "sent_notices" USING btree ("user_id");