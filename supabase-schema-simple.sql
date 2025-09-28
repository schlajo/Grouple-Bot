-- Supabase Database Schema for Wordle Bot (Simplified)
-- Run this in your Supabase SQL Editor

-- Games table - stores active game state
CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    word VARCHAR(10) NOT NULL,
    date DATE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    is_custom_word BOOLEAN DEFAULT false,
    host_user_id VARCHAR(20),
    last_guess_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Guesses table - stores all player guesses
CREATE TABLE IF NOT EXISTS guesses (
    id SERIAL PRIMARY KEY,
    game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    guess VARCHAR(10) NOT NULL,
    result TEXT NOT NULL,
    is_winner BOOLEAN DEFAULT false,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Player stats table - stores win/loss statistics
CREATE TABLE IF NOT EXISTS player_stats (
    user_id VARCHAR(20) PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    total_games INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Pending hosts table - stores temporary host requests
CREATE TABLE IF NOT EXISTS pending_hosts (
    user_id VARCHAR(20) PRIMARY KEY,
    channel_id VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_games_date_active ON games(date, is_active);
CREATE INDEX IF NOT EXISTS idx_guesses_game_id ON guesses(game_id);
CREATE INDEX IF NOT EXISTS idx_guesses_user_id ON guesses(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_hosts_created_at ON pending_hosts(created_at);

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers to automatically update updated_at
CREATE TRIGGER update_games_updated_at BEFORE UPDATE ON games
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_player_stats_updated_at BEFORE UPDATE ON player_stats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
