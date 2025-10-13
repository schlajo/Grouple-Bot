-- Migration to Add Guild (Server) Separation
-- Run this in your Supabase SQL Editor to separate servers
-- IMPORTANT: Run this BEFORE deploying the updated bot code

-- 1. Add guild_id column to games table
ALTER TABLE games ADD COLUMN IF NOT EXISTS guild_id VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- 2. Add guild_id column to guesses table
-- (guesses are linked to games, but we add guild_id for easier querying)
ALTER TABLE guesses ADD COLUMN IF NOT EXISTS guild_id VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- 3. Add guild_id column to player_stats table
ALTER TABLE player_stats ADD COLUMN IF NOT EXISTS guild_id VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- 4. Add guild_id column to pending_hosts table
ALTER TABLE pending_hosts ADD COLUMN IF NOT EXISTS guild_id VARCHAR(20) NOT NULL DEFAULT 'legacy';

-- 5. Update primary key for player_stats to be (user_id, guild_id)
-- This allows same user to have separate stats in different servers
ALTER TABLE player_stats DROP CONSTRAINT IF EXISTS player_stats_pkey;
ALTER TABLE player_stats ADD PRIMARY KEY (user_id, guild_id);

-- 6. Update primary key for pending_hosts to be (user_id, guild_id)
ALTER TABLE pending_hosts DROP CONSTRAINT IF EXISTS pending_hosts_pkey;
ALTER TABLE pending_hosts ADD PRIMARY KEY (user_id, guild_id);

-- 7. Add indexes for guild_id for better performance
CREATE INDEX IF NOT EXISTS idx_games_guild_id ON games(guild_id);
CREATE INDEX IF NOT EXISTS idx_games_guild_date_active ON games(guild_id, date, is_active);
CREATE INDEX IF NOT EXISTS idx_guesses_guild_id ON guesses(guild_id);
CREATE INDEX IF NOT EXISTS idx_player_stats_guild_id ON player_stats(guild_id);
CREATE INDEX IF NOT EXISTS idx_pending_hosts_guild_id ON pending_hosts(guild_id);

-- 8. Note: global_stats table remains unchanged - it tracks stats across ALL servers
-- This is intentional - you can still see community-wide statistics

-- AFTER running this migration:
-- 1. Any existing data will be tagged with guild_id = 'legacy'
-- 2. Deploy the updated bot code
-- 3. The bot will now track each server separately
-- 4. Legacy data will only appear in the server with guild_id matching your existing server
--    (or you can manually update the guild_id for legacy data to match your server's ID)

