-- Add total_guesses column to player_stats table
-- Run this in your Supabase SQL Editor

ALTER TABLE player_stats 
ADD COLUMN IF NOT EXISTS total_guesses INTEGER DEFAULT 0;

-- Update existing records to have 0 guesses if they don't have the column
UPDATE player_stats 
SET total_guesses = 0 
WHERE total_guesses IS NULL;
