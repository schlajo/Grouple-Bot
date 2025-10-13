# Guild Separation Upgrade Guide

This guide will help you upgrade your Grouple Bot to support multiple Discord servers independently.

## What's Changed?

**Before:** All servers shared the same game, stats, and data.  
**After:** Each server has its own independent game, leaderboard, and player stats.

## ⚠️ Important Notes

- **Global stats (`!global-stats`)** remain shared across all servers - this is intentional
- Your existing server's data will be tagged as "legacy" and needs manual migration (optional)
- **Do not deploy the updated code before running the database migration**

## Step-by-Step Upgrade Process

### Step 1: Backup Your Database

Before making any changes, create a backup of your Supabase database:

1. Go to your Supabase dashboard
2. Navigate to Database → Backups
3. Create a manual backup

### Step 2: Run the Database Migration

1. Open Supabase SQL Editor
2. Copy and paste the contents of `add-guild-separation.sql`
3. Click "Run"
4. Verify that all tables now have a `guild_id` column:
   ```sql
   SELECT column_name, data_type
   FROM information_schema.columns
   WHERE table_name IN ('games', 'guesses', 'player_stats', 'pending_hosts')
   AND column_name = 'guild_id';
   ```

### Step 3: (Optional) Migrate Legacy Data

If you want your existing data to appear in your current server:

1. Find your Discord server's Guild ID:

   - Enable Developer Mode in Discord (User Settings → Advanced → Developer Mode)
   - Right-click your server icon → Copy Server ID

2. Run this SQL in Supabase SQL Editor:
   ```sql
   -- Replace 'YOUR_GUILD_ID_HERE' with your actual guild ID
   UPDATE games SET guild_id = 'YOUR_GUILD_ID_HERE' WHERE guild_id = 'legacy';
   UPDATE guesses SET guild_id = 'YOUR_GUILD_ID_HERE' WHERE guild_id = 'legacy';
   UPDATE player_stats SET guild_id = 'YOUR_GUILD_ID_HERE' WHERE guild_id = 'legacy';
   UPDATE pending_hosts SET guild_id = 'YOUR_GUILD_ID_HERE' WHERE guild_id = 'legacy';
   ```

### Step 4: Deploy Updated Code

Your updated files are:

- `bot.js` - Now tracks games per guild
- `database.js` - All queries now include guild_id
- `add-guild-separation.sql` - Migration script (already run)

**If using Railway:**

1. Commit and push your changes:
   ```bash
   git add .
   git commit -m "Add guild separation support"
   git push origin main
   ```
2. Railway will automatically deploy
3. Monitor the logs to ensure successful startup

**If deploying manually:**

1. Update your files on your server
2. Restart the bot
3. Check logs for any errors

### Step 5: Verify the Upgrade

1. **Check bot startup logs** - should see:

   ```
   Loading data for guild: YourServerName (guild_id)
   Game restored for guild YourServerName!
   All guilds loaded. Waiting for 9 AM or commands...
   ```

2. **Test basic functionality:**

   - Run `!wordle-help` to verify bot responds
   - Run `!wordle-stats` to see your leaderboard (should be server-specific)
   - Start a game with `!start-wordle`
   - Make a guess with `!guess WORD`

3. **If you have multiple servers:**
   - Invite the bot to a second server
   - Verify games are independent (different words, different stats)

## What Each Server Gets Independently

✅ **Separate per server:**

- Active game (word, guesses, winners)
- Player statistics and leaderboards (`!wordle-stats`)
- Pending host requests
- Daily 9 AM game

✅ **Still shared across all servers:**

- Global statistics (`!global-stats`) - community-wide data

## Troubleshooting

### Error: "guildId is required"

- The bot tried to access the database before the migration
- **Solution:** Ensure you ran the migration SQL first, then restart the bot

### My old stats are gone

- They're tagged as `guild_id = 'legacy'`
- **Solution:** Run the legacy data migration SQL (Step 3)

### Bot not starting games at 9 AM in all servers

- Check Railway logs for errors
- Ensure the bot has permission to send messages in your server channels
- The bot looks for channels named: general, wordle, games, chat (or uses first available)

### Players from different servers appear in leaderboard

- The migration didn't complete properly
- **Solution:** Verify guild_id columns exist, restart bot

## Rolling Back (Emergency)

If something goes wrong:

1. **Restore Supabase backup** (from Step 1)
2. **Revert code changes:**
   ```bash
   git revert HEAD
   git push origin main
   ```
3. **Redeploy** - Railway will automatically deploy the reverted code

## Questions or Issues?

- Check Railway logs for detailed error messages
- Verify your Supabase connection is still working
- Ensure environment variables (DISCORD_TOKEN, SUPABASE_URL, etc.) are still set

---

## Technical Details

### Database Schema Changes

New columns added to all tables:

- `games.guild_id` - Links game to specific server
- `guesses.guild_id` - Links guesses to specific server
- `player_stats.guild_id` - Links player stats to specific server
- `pending_hosts.guild_id` - Links host requests to specific server

Primary key changes:

- `player_stats`: Now `(user_id, guild_id)` - allows same user in multiple servers
- `pending_hosts`: Now `(user_id, guild_id)` - allows hosting in multiple servers

### Code Architecture Changes

**Before:**

```javascript
let currentGame = { ... };  // Single game object
let playerStats = new Map();  // Single stats map
```

**After:**

```javascript
let guildGames = new Map(); // Map of guildId -> game
let guildPlayerStats = new Map(); // Map of guildId -> Map of stats
```

All functions now require `guildId` as first parameter to ensure data isolation.
