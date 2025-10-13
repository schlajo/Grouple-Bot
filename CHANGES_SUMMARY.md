# Guild Separation Implementation - Summary

## ✅ What Was Done

Your Grouple Bot has been successfully updated to support **multiple Discord servers independently**.

## 📁 New Files Created

1. **`add-guild-separation.sql`** - Database migration script

   - Adds `guild_id` column to all tables
   - Updates primary keys for multi-server support
   - Creates necessary indexes for performance

2. **`GUILD_SEPARATION_UPGRADE.md`** - Comprehensive upgrade guide

   - Step-by-step migration instructions
   - Troubleshooting section
   - Rollback procedures

3. **`CHANGES_SUMMARY.md`** - This file (quick reference)

## 🔧 Modified Files

### `database.js`

- All functions now require `guildId` parameter
- All database queries filter by `guild_id`
- Player stats now keyed by `(user_id, guild_id)` pair

### `bot.js`

- Changed from single game to `Map<guildId, game>`
- Changed from single stats to `Map<guildId, Map<userId, stats>>`
- All commands now operate on guild-specific data
- Cron job now starts games for each guild independently
- Bot initialization loads data for all guilds

## 🎯 What This Means

### Before This Change

- ❌ All servers shared the same game
- ❌ All servers shared the same leaderboard
- ❌ Players from different servers played together
- ❌ One word for everyone across all servers

### After This Change

- ✅ Each server has its own game
- ✅ Each server has its own leaderboard
- ✅ Players only compete with their server members
- ✅ Different words for different servers
- ✅ Global stats (`!global-stats`) still shared (by design)

## 🚀 Next Steps

### For Existing Deployment:

1. **Run the migration** (DO THIS FIRST):

   ```
   Open Supabase SQL Editor → Run add-guild-separation.sql
   ```

2. **Deploy the updated code**:

   ```bash
   git add .
   git commit -m "Add guild separation support"
   git push origin main
   ```

   Railway will automatically deploy.

3. **Verify it works**:
   - Check Railway logs for "Loading data for guild: [YourServerName]"
   - Test with `!wordle-stats` (should show your server's stats only)
   - Test with `!start-wordle` (should start a game for your server only)

### For Adding to a Second Server:

1. Generate your bot invite link (if you don't have it):

   - Go to [Discord Developer Portal](https://discord.com/developers/applications)
   - Select your application → OAuth2 → URL Generator
   - Select scopes: `bot`
   - Select permissions: `Send Messages`, `Read Messages`, `Read Message History`
   - Copy the generated URL

2. Use the invite link in the second server

3. The bot will automatically:
   - Load that server's data (or create new empty data)
   - Start games at 9 AM for that server
   - Track stats separately for that server

## 📊 Data Isolation

### Separate Per Server:

- Current game word and guesses
- Player leaderboards (`!wordle-stats`)
- Active game state (`!wordle-status`)
- Custom word hosting
- Daily 9 AM game start

### Shared Across All Servers:

- Global statistics (`!global-stats`)
- Total community games solved
- Average guesses per game

## 🔒 Railway Hosting

**You still only need ONE Railway deployment.**

- One bot instance serves all servers
- Railway connects to Supabase with one database
- Data separation happens in the database using `guild_id`

## ⚠️ Important Reminders

1. **Run the SQL migration BEFORE deploying code**
2. Your existing data is tagged as `guild_id = 'legacy'` until you migrate it
3. To migrate legacy data, see Step 3 in `GUILD_SEPARATION_UPGRADE.md`
4. Create a Supabase backup before migrating (just in case)

## 🆘 If Something Goes Wrong

1. Check Railway logs for specific errors
2. Verify the migration ran successfully (check if `guild_id` columns exist)
3. See troubleshooting section in `GUILD_SEPARATION_UPGRADE.md`
4. Rollback instructions are in the upgrade guide

## 📞 Testing Checklist

After deployment, verify:

- [ ] Bot starts without errors
- [ ] `!wordle-help` works
- [ ] `!start-wordle` creates a game
- [ ] `!guess WORD` accepts guesses
- [ ] `!wordle-stats` shows server-specific leaderboard
- [ ] `!global-stats` shows community-wide stats
- [ ] If you have 2+ servers, verify games are independent

---

**Ready to deploy?** Follow the steps in `GUILD_SEPARATION_UPGRADE.md` for detailed instructions.
