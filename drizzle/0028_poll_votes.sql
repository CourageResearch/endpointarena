CREATE TABLE "poll_votes" (
	"id" text PRIMARY KEY NOT NULL,
	"nct_number" text NOT NULL,
	"voter_hash" text NOT NULL,
	"week_start_date" date NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "poll_votes_nct_number_check" CHECK ("poll_votes"."nct_number" ~ '^NCT[0-9]{8}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poll_votes_voter_week_idx" ON "poll_votes" USING btree ("voter_hash","week_start_date");--> statement-breakpoint
CREATE INDEX "poll_votes_nct_week_idx" ON "poll_votes" USING btree ("nct_number","week_start_date");--> statement-breakpoint
CREATE INDEX "poll_votes_created_at_idx" ON "poll_votes" USING btree ("created_at");
