ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS ssnit_number text;
ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS tin text;

ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS ssnit_employee_pesewas bigint NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS ssnit_employer_pesewas bigint NOT NULL DEFAULT 0;
ALTER TABLE payroll_lines ADD COLUMN IF NOT EXISTS paye_pesewas bigint NOT NULL DEFAULT 0;
