-- Migration: Populate word_stats table from existing historical data
-- Run this in your Supabase SQL Editor AFTER creating the word_stats table
-- This will analyze all past solved games and populate word statistics

-- Step 1: Insert word stats from all solved games (games with winners)
-- This calculates total guesses per game and aggregates by word
INSERT INTO word_stats (word, word_length, times_played, total_guesses_all_games, average_guesses, min_guesses, max_guesses)
SELECT 
    g.word,
    LENGTH(g.word) as word_length,
    COUNT(DISTINCT g.id) as times_played,
    SUM(guess_counts.total_guesses) as total_guesses_all_games,
    ROUND(AVG(guess_counts.total_guesses)::numeric, 2) as average_guesses,
    MIN(guess_counts.total_guesses) as min_guesses,
    MAX(guess_counts.total_guesses) as max_guesses
FROM games g
INNER JOIN (
    -- Count total guesses per game (only for games that were solved - have winners)
    SELECT 
        game_id,
        COUNT(*) as total_guesses
    FROM guesses
    WHERE game_id IN (
        SELECT DISTINCT game_id 
        FROM guesses 
        WHERE is_winner = true
    )
    GROUP BY game_id
) guess_counts ON g.id = guess_counts.game_id
WHERE g.is_active = false  -- Only solved/ended games
GROUP BY g.word, LENGTH(g.word)
ON CONFLICT (word) DO UPDATE SET
    times_played = EXCLUDED.times_played,
    total_guesses_all_games = EXCLUDED.total_guesses_all_games,
    average_guesses = EXCLUDED.average_guesses,
    min_guesses = EXCLUDED.min_guesses,
    max_guesses = EXCLUDED.max_guesses,
    updated_at = NOW();

-- Step 2: If there are any words that appeared multiple times, we need to handle min/max correctly
-- This ensures min_guesses is the actual minimum and max_guesses is the actual maximum
UPDATE word_stats ws
SET 
    min_guesses = subquery.min_g,
    max_guesses = subquery.max_g
FROM (
    SELECT 
        g.word,
        MIN(guess_counts.total_guesses) as min_g,
        MAX(guess_counts.total_guesses) as max_g
    FROM games g
    INNER JOIN (
        SELECT 
            game_id,
            COUNT(*) as total_guesses
        FROM guesses
        WHERE game_id IN (
            SELECT DISTINCT game_id 
            FROM guesses 
            WHERE is_winner = true
        )
        GROUP BY game_id
    ) guess_counts ON g.id = guess_counts.game_id
    WHERE g.is_active = false
    GROUP BY g.word
) subquery
WHERE ws.word = subquery.word;

