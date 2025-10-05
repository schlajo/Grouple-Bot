-- Global Statistics Table for Wordle Bot
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS global_stats (
    id SERIAL PRIMARY KEY,
    
    -- Overall totals
    games_solved INTEGER DEFAULT 0,
    total_guesses_in_solved_games INTEGER DEFAULT 0,
    
    -- Custom vs Generated
    custom_games_solved INTEGER DEFAULT 0,
    custom_guesses_total INTEGER DEFAULT 0,
    generated_games_solved INTEGER DEFAULT 0,
    generated_guesses_total INTEGER DEFAULT 0,
    
    -- Word length breakdowns
    word_length_3_solved INTEGER DEFAULT 0,
    word_length_3_guesses INTEGER DEFAULT 0,
    word_length_4_solved INTEGER DEFAULT 0,
    word_length_4_guesses INTEGER DEFAULT 0,
    word_length_5_solved INTEGER DEFAULT 0,
    word_length_5_guesses INTEGER DEFAULT 0,
    word_length_6_solved INTEGER DEFAULT 0,
    word_length_6_guesses INTEGER DEFAULT 0,
    word_length_7_solved INTEGER DEFAULT 0,
    word_length_7_guesses INTEGER DEFAULT 0,
    word_length_8_solved INTEGER DEFAULT 0,
    word_length_8_guesses INTEGER DEFAULT 0,
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create a trigger to update the updated_at timestamp
CREATE TRIGGER update_global_stats_updated_at BEFORE UPDATE ON global_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial record with all zeros
INSERT INTO global_stats (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
