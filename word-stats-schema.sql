-- Word Statistics Table for Wordle Bot
-- Tracks individual word performance (most/least guesses per word)
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS word_stats (
    word VARCHAR(10) PRIMARY KEY,
    word_length INTEGER NOT NULL,
    times_played INTEGER DEFAULT 0,
    total_guesses_all_games INTEGER DEFAULT 0,
    average_guesses DECIMAL(10, 2) DEFAULT 0,
    min_guesses INTEGER DEFAULT 999999,  -- Lowest guesses in any single game
    max_guesses INTEGER DEFAULT 0,        -- Highest guesses in any single game
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for faster queries by word length
CREATE INDEX IF NOT EXISTS idx_word_stats_length ON word_stats(word_length);

-- Create a trigger to update the updated_at timestamp
CREATE TRIGGER update_word_stats_updated_at BEFORE UPDATE ON word_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

