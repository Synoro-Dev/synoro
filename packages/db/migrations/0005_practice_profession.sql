CREATE TYPE "public"."practice_profession" AS ENUM('psychologist', 'coach', 'tutor', 'trainer', 'health', 'legal', 'other');--> statement-breakpoint
-- Practices created so far were set up with psychologist wording: keep it.
ALTER TABLE "practices" ADD COLUMN "profession" "practice_profession" DEFAULT 'psychologist' NOT NULL;--> statement-breakpoint
ALTER TABLE "practices" ALTER COLUMN "profession" SET DEFAULT 'other';
