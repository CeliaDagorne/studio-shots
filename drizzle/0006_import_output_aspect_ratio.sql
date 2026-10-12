ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "output_aspect_ratio" text DEFAULT '4:5' NOT NULL;--> statement-breakpoint
ALTER TABLE "imports" DROP CONSTRAINT IF EXISTS "imports_output_aspect_ratio_check";--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_output_aspect_ratio_check" CHECK ("output_aspect_ratio" IN ('4:5', '1:1', '3:2'));
