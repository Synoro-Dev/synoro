CREATE TABLE "practice_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "practice_member_role" NOT NULL,
	"invited_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '7 days' NOT NULL,
	CONSTRAINT "practice_invitations_practice_email_role_unique" UNIQUE("practice_id","email","role"),
	CONSTRAINT "practice_invitations_role_valid" CHECK ("practice_invitations"."role" in ('admin', 'client'))
);
--> statement-breakpoint
ALTER TABLE "practice_invitations" ADD CONSTRAINT "practice_invitations_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_invitations" ADD CONSTRAINT "practice_invitations_invited_by_id_users_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;