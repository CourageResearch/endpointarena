ALTER TABLE "trial_monitor_configs" ADD COLUMN "cron_processing_concurrency" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_monitor_configs" ADD COLUMN "manual_processing_concurrency" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "trial_monitor_configs" ADD CONSTRAINT "trial_monitor_configs_cron_processing_concurrency_check" CHECK ("trial_monitor_configs"."cron_processing_concurrency" >= 1 AND "trial_monitor_configs"."cron_processing_concurrency" <= 12);--> statement-breakpoint
ALTER TABLE "trial_monitor_configs" ADD CONSTRAINT "trial_monitor_configs_manual_processing_concurrency_check" CHECK ("trial_monitor_configs"."manual_processing_concurrency" >= 1 AND "trial_monitor_configs"."manual_processing_concurrency" <= 12);
