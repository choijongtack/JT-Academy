-- Add RLS policies for admin users to manage questions

-- Policy for admins to UPDATE questions
CREATE POLICY "Admins can update questions"
ON questions
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

-- Policy for admins to DELETE questions
CREATE POLICY "Admins can delete questions"
ON questions
FOR DELETE
TO authenticated
USING (
  auth.jwt() ->> 'email' = 'admin@gmail.com'
  OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
);

-- Policy for admins to SELECT all questions (if not already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'questions' 
    AND policyname = 'Admins can select all questions'
  ) THEN
    CREATE POLICY "Admins can select all questions"
    ON questions
    FOR SELECT
    TO authenticated
    USING (
      auth.jwt() ->> 'email' = 'admin@gmail.com'
      OR auth.jwt() ->> 'email' LIKE '%@elec-admin.com'
    );
  END IF;
END $$;
