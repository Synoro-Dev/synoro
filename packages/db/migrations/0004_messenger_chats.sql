CREATE TYPE "public"."messenger" AS ENUM('telegram', 'max');--> statement-breakpoint
CREATE TABLE "messenger_chats" (
	"user_id" text PRIMARY KEY NOT NULL,
	"messenger" "messenger" NOT NULL,
	"chat_id" varchar(32) NOT NULL,
	"username" varchar(64),
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "messenger_link_codes" (
	"code_hash" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"messenger" "messenger" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messenger_chats" ADD CONSTRAINT "messenger_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messenger_link_codes" ADD CONSTRAINT "messenger_link_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messenger_link_codes_user_idx" ON "messenger_link_codes" USING btree ("user_id");