DO $$ BEGIN
	CREATE TYPE "public"."workflow_trigger" AS ENUM('after_end', 'low_balance', 'inactive');
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"trigger" "workflow_trigger" NOT NULL,
	"amount" smallint NOT NULL,
	"subject" varchar(120) NOT NULL,
	"text" varchar(1000) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "workflows_amount_range" CHECK (("workflows"."trigger" = 'after_end' and "workflows"."amount" between 1 and 72)
        or ("workflows"."trigger" = 'low_balance' and "workflows"."amount" between 0 and 5)
        or ("workflows"."trigger" = 'inactive' and "workflows"."amount" between 7 and 180))
);
--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "workflows" ADD CONSTRAINT "workflows_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflows_practice_idx" ON "workflows" USING btree ("practice_id");
