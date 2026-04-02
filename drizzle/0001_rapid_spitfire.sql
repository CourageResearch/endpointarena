CREATE TABLE "trial_question_outcome_history" (
	"id" text PRIMARY KEY NOT NULL,
	"trial_question_id" text NOT NULL,
	"previous_outcome" text,
	"previous_outcome_date" timestamp with time zone,
	"next_outcome" text NOT NULL,
	"next_outcome_date" timestamp with time zone,
	"changed_at" timestamp with time zone NOT NULL,
	"change_source" text NOT NULL,
	"changed_by_user_id" text,
	"review_candidate_id" text,
	"notes" text,
	CONSTRAINT "trial_question_outcome_history_previous_outcome_check" CHECK ("trial_question_outcome_history"."previous_outcome" IS NULL OR "trial_question_outcome_history"."previous_outcome" IN ('Pending', 'YES', 'NO')),
	CONSTRAINT "trial_question_outcome_history_next_outcome_check" CHECK ("trial_question_outcome_history"."next_outcome" IN ('Pending', 'YES', 'NO')),
	CONSTRAINT "trial_question_outcome_history_change_source_check" CHECK ("trial_question_outcome_history"."change_source" IN ('manual_admin', 'accepted_candidate'))
);
--> statement-breakpoint
ALTER TABLE "trial_question_outcome_history" ADD CONSTRAINT "trial_question_outcome_history_trial_question_id_trial_questions_id_fk" FOREIGN KEY ("trial_question_id") REFERENCES "public"."trial_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_question_outcome_history" ADD CONSTRAINT "trial_question_outcome_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trial_question_outcome_history" ADD CONSTRAINT "trial_question_outcome_history_review_candidate_id_trial_outcome_candidates_id_fk" FOREIGN KEY ("review_candidate_id") REFERENCES "public"."trial_outcome_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trial_question_outcome_history_question_changed_at_idx" ON "trial_question_outcome_history" USING btree ("trial_question_id","changed_at");--> statement-breakpoint
CREATE INDEX "trial_question_outcome_history_changed_at_idx" ON "trial_question_outcome_history" USING btree ("changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trial_question_outcome_history_review_candidate_id_idx" ON "trial_question_outcome_history" USING btree ("review_candidate_id");