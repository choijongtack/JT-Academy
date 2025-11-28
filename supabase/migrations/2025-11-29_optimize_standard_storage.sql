-- Migration: Optimize certification standard storage for large documents
-- Date: 2025-11-29
-- Adds supporting tables for storing uploaded standard files and chunked sections

-- Table for storing metadata about each uploaded standard file (PDF, image, etc.)
CREATE TABLE IF NOT EXISTS certification_standard_files (
    id BIGSERIAL PRIMARY KEY,
    standard_id BIGINT NOT NULL REFERENCES certification_standards(id) ON DELETE CASCADE,
    storage_url TEXT NOT NULL,
    original_filename TEXT,
    file_type TEXT,
    file_size BIGINT,
    page_count INTEGER,
    sort_index INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_standard_files_standard_id
    ON certification_standard_files (standard_id);

-- Table for storing chunked/sectioned text extracted from standards
CREATE TABLE IF NOT EXISTS certification_standard_sections (
    id BIGSERIAL PRIMARY KEY,
    standard_id BIGINT NOT NULL REFERENCES certification_standards(id) ON DELETE CASCADE,
    section_index INTEGER NOT NULL,
    start_page INTEGER,
    end_page INTEGER,
    content TEXT NOT NULL,
    char_count INTEGER,
    token_estimate INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_standard_sections_standard_id
    ON certification_standard_sections (standard_id);

CREATE INDEX IF NOT EXISTS idx_cert_standard_sections_section_index
    ON certification_standard_sections (standard_id, section_index);

-- Ensure updated_at timestamp on certification_standards reflects changes
CREATE OR REPLACE FUNCTION update_cert_standard_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_cert_standard_updated_at ON certification_standards;

CREATE TRIGGER trg_update_cert_standard_updated_at
    BEFORE UPDATE ON certification_standards
    FOR EACH ROW
    EXECUTE FUNCTION update_cert_standard_updated_at();
