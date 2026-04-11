DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'phase2_trials'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'trials'
  ) THEN
    ALTER TABLE "phase2_trials" RENAME TO "trials";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'trials'
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phase2_trials_pkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trials_pkey'
  ) THEN
    ALTER TABLE "trials" RENAME CONSTRAINT "phase2_trials_pkey" TO "trials_pkey";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF to_regclass('public.phase2_trials_nct_number_idx') IS NOT NULL
    AND to_regclass('public.trials_nct_number_idx') IS NULL THEN
    ALTER INDEX "phase2_trials_nct_number_idx" RENAME TO "trials_nct_number_idx";
  END IF;

  IF to_regclass('public.phase2_trials_primary_completion_idx') IS NOT NULL
    AND to_regclass('public.trials_primary_completion_idx') IS NULL THEN
    ALTER INDEX "phase2_trials_primary_completion_idx" RENAME TO "trials_primary_completion_idx";
  END IF;

  IF to_regclass('public.phase2_trials_sponsor_ticker_idx') IS NOT NULL
    AND to_regclass('public.trials_sponsor_ticker_idx') IS NULL THEN
    ALTER INDEX "phase2_trials_sponsor_ticker_idx" RENAME TO "trials_sponsor_ticker_idx";
  END IF;

  IF to_regclass('public.phase2_trials_current_status_idx') IS NOT NULL
    AND to_regclass('public.trials_current_status_idx') IS NULL THEN
    ALTER INDEX "phase2_trials_current_status_idx" RENAME TO "trials_current_status_idx";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'trials'
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phase2_trials_est_enrollment_check'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trials_est_enrollment_check'
  ) THEN
    ALTER TABLE "trials" RENAME CONSTRAINT "phase2_trials_est_enrollment_check" TO "trials_est_enrollment_check";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'trials'
  ) AND EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'phase2_trials_source_check'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trials_source_check'
  ) THEN
    ALTER TABLE "trials" RENAME CONSTRAINT "phase2_trials_source_check" TO "trials_source_check";
  END IF;
END $$;--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trial_questions_trial_id_phase2_trials_id_fk'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trial_questions_trial_id_trials_id_fk'
  ) THEN
    ALTER TABLE "trial_questions"
      RENAME CONSTRAINT "trial_questions_trial_id_phase2_trials_id_fk"
      TO "trial_questions_trial_id_trials_id_fk";
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trial_sync_run_items_trial_id_phase2_trials_id_fk'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'trial_sync_run_items_trial_id_trials_id_fk'
  ) THEN
    ALTER TABLE "trial_sync_run_items"
      RENAME CONSTRAINT "trial_sync_run_items_trial_id_phase2_trials_id_fk"
      TO "trial_sync_run_items_trial_id_trials_id_fk";
  END IF;
END $$;
