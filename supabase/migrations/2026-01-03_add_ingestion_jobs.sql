-- Create ingestion_jobs table for structured pipeline tracking
CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  certification VARCHAR(100),
  subject VARCHAR(200),
  year INTEGER,
  exam_session INTEGER,
  source TEXT,
  request_payload JSONB,
  structure_analysis JSONB,
  problem_class TEXT,
  solve_input JSONB,
  solver_output JSONB,
  verification_result JSONB,
  failure_reason TEXT,
  question_id BIGINT REFERENCES questions(id)
);

ALTER TABLE ingestion_jobs
  ADD CONSTRAINT ingestion_jobs_status_check
  CHECK (status IN (
    'RECEIVED',
    'STRUCTURED',
    'CLASSIFIED',
    'SOLVED',
    'VERIFIED',
    'FAILED',
    'NEEDS_REVIEW'
  ));

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_cert_subject ON ingestion_jobs(certification, subject);
CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_created_at ON ingestion_jobs(created_at DESC);

ALTER TABLE ingestion_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can insert ingestion jobs"
ON ingestion_jobs
FOR INSERT
TO authenticated
WITH CHECK (
  auth.jwt() ->> 'email' = 'admin@gmail.com'
  OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
);

CREATE POLICY "Admins can update ingestion jobs"
ON ingestion_jobs
FOR UPDATE
TO authenticated
USING (
  auth.jwt() ->> 'email' = 'admin@gmail.com'
  OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
)
WITH CHECK (
  auth.jwt() ->> 'email' = 'admin@gmail.com'
  OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
);

CREATE POLICY "Admins can select ingestion jobs"
ON ingestion_jobs
FOR SELECT
TO authenticated
USING (
  auth.jwt() ->> 'email' = 'admin@gmail.com'
  OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
);
