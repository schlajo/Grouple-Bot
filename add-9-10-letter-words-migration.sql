-- Migration: Add 9 and 10 letter word stats columns to global_stats table
-- Run this in your Supabase SQL Editor
-- This will NOT erase any existing data - it only adds new columns with default values

ALTER TABLE global_stats
ADD COLUMN IF NOT EXISTS word_length_9_solved INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS word_length_9_guesses INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS word_length_10_solved INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS word_length_10_guesses INTEGER DEFAULT 0;

-- Update any existing rows to have 0 instead of NULL (if any exist)
UPDATE global_stats
SET 
    word_length_9_solved = COALESCE(word_length_9_solved, 0),
    word_length_9_guesses = COALESCE(word_length_9_guesses, 0),
    word_length_10_solved = COALESCE(word_length_10_solved, 0),
    word_length_10_guesses = COALESCE(word_length_10_guesses, 0)
WHERE id = 1;

