CREATE TABLE "ai2_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"dataset" text NOT NULL,
	"status" text NOT NULL,
	"state" jsonb NOT NULL,
	"error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai2_batches_dataset_check" CHECK ("ai2_batches"."dataset" IN ('toy', 'live')),
	CONSTRAINT "ai2_batches_status_check" CHECK ("ai2_batches"."status" IN ('collecting', 'waiting', 'ready', 'clearing', 'cleared', 'failed', 'reset'))
);
--> statement-breakpoint
CREATE INDEX "ai2_batches_dataset_idx" ON "ai2_batches" USING btree ("dataset");--> statement-breakpoint
CREATE INDEX "ai2_batches_status_idx" ON "ai2_batches" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ai2_batches_dataset_status_idx" ON "ai2_batches" USING btree ("dataset","status");--> statement-breakpoint
CREATE INDEX "ai2_batches_created_at_idx" ON "ai2_batches" USING btree ("created_at");