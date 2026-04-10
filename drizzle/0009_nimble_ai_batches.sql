ALTER TABLE "ai2_batches" RENAME TO "ai_batches";--> statement-breakpoint
ALTER INDEX "ai2_batches_dataset_idx" RENAME TO "ai_batches_dataset_idx";--> statement-breakpoint
ALTER INDEX "ai2_batches_status_idx" RENAME TO "ai_batches_status_idx";--> statement-breakpoint
ALTER INDEX "ai2_batches_dataset_status_idx" RENAME TO "ai_batches_dataset_status_idx";--> statement-breakpoint
ALTER INDEX "ai2_batches_created_at_idx" RENAME TO "ai_batches_created_at_idx";--> statement-breakpoint
ALTER TABLE "ai_batches" RENAME CONSTRAINT "ai2_batches_dataset_check" TO "ai_batches_dataset_check";--> statement-breakpoint
ALTER TABLE "ai_batches" RENAME CONSTRAINT "ai2_batches_status_check" TO "ai_batches_status_check";
