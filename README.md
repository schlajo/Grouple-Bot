# 🎯 Grouple Bot - Discord Wordle Game

A Discord bot that hosts daily group Wordle games for your server! Perfect for friend groups who want to play Wordle together every day.

## ✨ Features

- **Daily Games**: Automatically starts a new Wordle game every day at 9 AM
- **Group Play**: Everyone gets one guess per day
- **Real-time Feedback**: Get instant color-coded results for your guesses
- **Winner Tracking**: Celebrates daily winners
- **Manual Controls**: Start/end games manually for testing or extra fun
- **Beautiful Embeds**: Clean, colorful Discord embed messages

## 🎮 How to Play

1. Wait for the daily 9 AM message or use `!start-wordle`
2. Type `!guess WORD` with your 5-letter guess
3. Get instant feedback with color-coded results:
   - 🟩 Green: Correct letter in correct position
   - 🟨 Yellow: Letter is in word but wrong position
   - ⬜ Gray: Letter not in word
4. Winners are announced and celebrated!

## 🤖 Commands

- `!guess WORD` - Make your daily guess (5 letters only)
- `!wordle-status` - See current game status and all guesses
- `!start-wordle` - Start a new game manually
- `!end-wordle` - End current game and show results
- `!wordle-help` - Show help message

## 🛠️ Setup Instructions

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click "New Application" and give it a name (e.g., "Grouple Bot")
3. Go to the "Bot" section
4. Click "Add Bot"
5. Copy the bot token (you'll need this later)
6. Under "Privileged Gateway Intents", enable:
   - Message Content Intent

### 2. Install the Bot

1. Clone or download this project
2. Install Node.js if you haven't already
3. Run: `npm install`
4. Copy `env.example` to `.env`: `cp env.example .env`
5. Edit `.env` and add your bot token:
   ```
   DISCORD_TOKEN=your_bot_token_here
   ```

### 3. Invite Bot to Your Server

1. In Discord Developer Portal, go to "OAuth2" > "URL Generator"
2. Select these scopes:
   - `bot`
3. Select these bot permissions:
   - Send Messages
   - Use Slash Commands
   - Read Message History
   - Embed Links
4. Copy the generated URL and open it to invite the bot to your server

### 4. Run the Bot

```bash
npm start
```

The bot will:

- Start up and connect to Discord
- Schedule daily games at 9 AM
- Respond to commands immediately

## ⚙️ Configuration

### Timezone

Edit the timezone in `bot.js` line 173:

```javascript
timezone: "America/New_York"; // Change this to your timezone
```

### Channel Selection

The bot automatically finds channels named:

- `general`
- `wordle`
- `games`
- `chat`

Or uses the first available text channel.

### Word List

Words are loaded from `words.json`. You can:

- Add new words
- Remove words you don't like
- Use themed word lists for special occasions

## 🔧 Troubleshooting

**Bot doesn't respond:**

- Check the bot token in `.env`
- Make sure the bot has the right permissions
- Check that Message Content Intent is enabled

**Daily games don't start:**

- Check your timezone setting
- Make sure the bot is running 24/7
- Verify the bot can send messages in your channels

**Commands don't work:**

- Make sure you're typing them exactly (case-sensitive)
- Check that the bot can read messages in the channel

## 🚀 Hosting

For 24/7 operation, consider hosting on:

- [Railway](https://railway.app/)
- [Heroku](https://heroku.com/)
- [DigitalOcean](https://digitalocean.com/)
- [Replit](https://replit.com/)

## 📝 License

MIT License - feel free to modify and share!

## 🎉 Have Fun!

Enjoy your daily group Wordle games! The bot will keep everyone engaged and add some friendly competition to your Discord server.

---

Made with ❤️ for friend groups who love Wordle!
