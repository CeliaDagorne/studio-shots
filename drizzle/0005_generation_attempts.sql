CREATE TABLE "generation_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"shot_request_id" text NOT NULL,
	"product_sku" text NOT NULL,
	"attempt_number" integer,
	"is_legacy" boolean DEFAULT false NOT NULL,
	"shot_idea" text NOT NULL,
	"aspect_ratio" text NOT NULL,
	"environment" text,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_shot_request_id_shot_requests_id_fk" FOREIGN KEY ("shot_request_id") REFERENCES "public"."shot_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_attempts" ADD CONSTRAINT "generation_attempts_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_request_attempt_idx" ON "generation_attempts" USING btree ("shot_request_id","attempt_number") WHERE "attempt_number" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_attempts_request_legacy_idx" ON "generation_attempts" USING btree ("shot_request_id") WHERE "is_legacy" = true;--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD COLUMN "generation_attempt_id" text;--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD CONSTRAINT "generation_candidates_generation_attempt_id_generation_attempts_id_fk" FOREIGN KEY ("generation_attempt_id") REFERENCES "public"."generation_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generation_candidates_attempt_id_idx" ON "generation_candidates" USING btree ("generation_attempt_id");
