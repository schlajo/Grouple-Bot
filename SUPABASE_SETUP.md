# Supabase Setup Guide for Wordle Bot

This guide will walk you through setting up Supabase to persist your Discord bot's game state and prevent data loss when Railway goes inactive.

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in to your account
3. Click "New Project"
4. Choose your organization
5. Enter project details:
   - **Name**: `wordle-bot` (or whatever you prefer)
   - **Database Password**: Choose a strong password (save this!)
   - **Region**: Choose the closest to your users
6. Click "Create new project"
7. Wait for the project to be created (this takes a few minutes)

## Step 2: Get Your Supabase Credentials

1. In your Supabase dashboard, go to **Settings** → **API**
2. Copy the following values:
   - **Project URL** (looks like: `https://your-project-id.supabase.co`)
   - **anon public** key (starts with `eyJ...`)

## Step 3: Set Up the Database Schema

1. In your Supabase dashboard, go to **SQL Editor**
2. Click "New Query"
3. Copy and paste the entire contents of `supabase-schema.sql` from your project
4. Click "Run" to execute the SQL
5. You should see success messages for each table creation

## Step 4: Configure Environment Variables

1. Copy your `.env.example` to `.env` (if you haven't already)
2. Add your Supabase credentials:

```env
# Discord Bot Token - Get this from https://discord.com/developers/applications
DISCORD_TOKEN=your_bot_token_here

# Supabase Configuration - Get these from https://supabase.com/dashboard
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=eyJ...your_anon_key_here
```

3. **For Railway deployment**, add these same environment variables in your Railway project settings

## Step 5: Test the Integration

1. Start your bot locally: `node bot.js`
2. Check the console output for:
   - `✅ Database connection successful`
   - `Loaded stats for X players from database`
   - `Game restored from database!` (if there was an active game)

## Step 6: Deploy to Railway

1. Push your changes to GitHub
2. Railway will automatically redeploy
3. Make sure your Railway environment variables are set:
   - `DISCORD_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

## How It Works

### Database Tables Created:

1. **`games`** - Stores active game state (word, date, host, etc.)
2. **`guesses`** - Stores all player guesses with results
3. **`player_stats`** - Stores win/loss statistics
4. **`pending_hosts`** - Stores temporary host requests

### Key Benefits:

- ✅ **Persistent Storage**: Game state survives Railway restarts
- ✅ **Automatic Cleanup**: Old games and data are automatically cleaned up
- ✅ **Real-time Sync**: All data is immediately saved to the database
- ✅ **Backup**: Your data is safely stored in Supabase's cloud database

### What Happens Now:

1. **Game State**: Automatically saved to database after every guess
2. **Player Stats**: Updated in real-time in the database
3. **Bot Restart**: Game state is restored from database on startup
4. **Railway Inactivity**: No more data loss when Railway goes to sleep!

## Troubleshooting

### Database Connection Issues:

- Verify your `SUPABASE_URL` and `SUPABASE_ANON_KEY` are correct
- Check that your Supabase project is active (not paused)
- Ensure the database schema was created successfully

### Game State Not Restoring:

- Check the console logs for database errors
- Verify the `games` table has data: Go to Supabase → Table Editor → `games`
- Make sure the bot has the correct timezone settings

### Performance Issues:

- Supabase free tier has generous limits, but if you hit them, consider upgrading
- The bot automatically cleans up old data to keep the database lean

## Monitoring

You can monitor your database usage in the Supabase dashboard:

- **Database** → **Usage** - See storage and bandwidth usage
- **Table Editor** - View and edit your data directly
- **Logs** - See database queries and errors

## Next Steps

Once everything is working:

1. Test a full game cycle (start → guess → win → end)
2. Restart your bot and verify game state is restored
3. Let Railway go inactive and verify data persists
4. Monitor the Supabase dashboard for any issues

Your bot should now be much more reliable and never lose game state again! 🎉
