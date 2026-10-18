ALTER TABLE folders ADD COLUMN IF NOT EXISTS event_date DATE;
CREATE INDEX IF NOT EXISTS idx_folders_event_date ON folders(event_date);
