-- Migration: Add certification support to questions table and create certification_standards table
-- Date: 2025-11-28
-- Description: Adds multi-certification support for 전기기사 and 신재생에너지발전설비기사(태양광)

-- Step 1: Add certification column to questions table
ALTER TABLE questions
ADD COLUMN IF NOT EXISTS certification VARCHAR(100) DEFAULT '전기기사';

-- Step 2: Create index for better query performance
CREATE INDEX IF NOT EXISTS idx_questions_certification ON questions(certification);

-- Step 3: Update existing records to have certification = '전기기사'
UPDATE questions
SET certification = '전기기사'
WHERE certification IS NULL;

-- Step 4: Create certification_standards table for storing exam standard PDFs
CREATE TABLE IF NOT EXISTS certification_standards (
  id BIGSERIAL PRIMARY KEY,
  certification VARCHAR(100) NOT NULL,
  subject VARCHAR(200) NOT NULL,
  pdf_url TEXT NOT NULL,
  extracted_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 5: Create indexes for certification_standards
CREATE INDEX IF NOT EXISTS idx_cert_standards_cert ON certification_standards(certification);
CREATE INDEX IF NOT EXISTS idx_cert_standards_subject ON certification_standards(subject);

-- Step 6: Create unique constraint to prevent duplicate standards for same cert+subject
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_standards_unique 
ON certification_standards(certification, subject);

-- Verification queries
-- Check if certification column exists and has data
SELECT certification, COUNT(*) as count 
FROM questions 
GROUP BY certification;

-- Check if certification_standards table is created
SELECT COUNT(*) FROM certification_standards;
