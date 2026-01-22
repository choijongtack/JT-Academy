-- Link questions to ingestion_jobs for traceability
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS ingestion_job_id BIGINT REFERENCES ingestion_jobs(id);

CREATE INDEX IF NOT EXISTS idx_questions_ingestion_job_id
ON questions(ingestion_job_id);
