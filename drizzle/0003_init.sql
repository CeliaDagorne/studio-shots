CREATE TABLE "generation_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"shot_request_id" text NOT NULL,
	"product_sku" text NOT NULL,
	"candidate_index" integer NOT NULL,
	"luma_generation_id" text,
	"luma_state" text,
	"status" text NOT NULL,
	"review_decision" text,
	"reviewed_at" timestamp with time zone,
	"blob_path" text,
	"blob_url" text,
	"prompt" text NOT NULL,
	"error_message" text,
	"telegram_chat_id" bigint,
	"telegram_message_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD CONSTRAINT "generation_candidates_shot_request_id_shot_requests_id_fk" FOREIGN KEY ("shot_request_id") REFERENCES "public"."shot_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_candidates" ADD CONSTRAINT "generation_candidates_product_sku_products_sku_fk" FOREIGN KEY ("product_sku") REFERENCES "public"."products"("sku") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "generation_candidates_request_index_idx" ON "generation_candidates" USING btree ("shot_request_id","candidate_index");