CREATE TABLE "sign_ins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"method" text,
	"impersonated_by" text,
	"ip_address" text,
	"user_agent" text,
	"country" varchar(2),
	"region" text,
	"city" text,
	"yclid" varchar(64),
	"yclid_at" timestamp with time zone,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"referrer_host" text,
	"landing_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sign_ins" ADD CONSTRAINT "sign_ins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sign_ins_user_created_idx" ON "sign_ins" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "sign_ins_created_idx" ON "sign_ins" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sign_ins_ip_idx" ON "sign_ins" USING btree ("ip_address");