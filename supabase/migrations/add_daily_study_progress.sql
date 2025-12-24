-- Track per-day study progress and targets for resume support
ALTER TABLE daily_study_logs
    ADD COLUMN IF NOT EXISTS reading_question_ids integer[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS review_question_ids integer[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS reading_target_count integer,
    ADD COLUMN IF NOT EXISTS review_target_count integer;
