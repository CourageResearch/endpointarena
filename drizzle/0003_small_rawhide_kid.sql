ALTER TABLE "trial_monitor_runs" DROP CONSTRAINT "trial_monitor_runs_status_check";--> statement-breakpoint
ALTER TABLE "trial_monitor_runs" ADD COLUMN "stop_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "trial_monitor_runs" ADD CONSTRAINT "trial_monitor_runs_status_check" CHECK ("trial_monitor_runs"."status" IN ('running', 'completed', 'failed', 'paused'));