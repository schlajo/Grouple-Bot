const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
require("dotenv").config();

// Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// Game state
let currentGame = {
  word: null,
  guesses: new Map(), // userId -> {guess, result, timestamp}
  date: null,
  winners: new Set(),
  isActive: false,
  lastGuessTime: null, // Track when the last guess was made
};

// Pending host requests
let pendingHosts = new Map(); // userId -> {channelId, timestamp}

// Win tracking
let playerStats = new Map(); // userId -> {wins: number, totalGames: number}

// Persistence functions
function saveGameState() {
  if (currentGame.isActive) {
    const gameData = {
      word: currentGame.word,
      guesses: Array.from(currentGame.guesses.entries()),
      date: currentGame.date,
      winners: Array.from(currentGame.winners),
      isActive: currentGame.isActive,
      lastGuessTime: currentGame.lastGuessTime,
      isCustomWord: currentGame.isCustomWord,
      host: currentGame.host,
    };

    try {
      fs.writeFileSync("game-state.json", JSON.stringify(gameData, null, 2));
      console.log("Game state saved successfully");
    } catch (error) {
      console.error("Error saving game state:", error);
    }
  }
}

function savePlayerStats() {
  try {
    const statsData = Array.from(playerStats.entries());
    fs.writeFileSync("player-stats.json", JSON.stringify(statsData, null, 2));
    console.log("Player stats saved successfully");
  } catch (error) {
    console.error("Error saving player stats:", error);
  }
}

function loadPlayerStats() {
  try {
    if (fs.existsSync("player-stats.json")) {
      const statsData = JSON.parse(
        fs.readFileSync("player-stats.json", "utf8")
      );
      playerStats = new Map(statsData);
      console.log(`Loaded stats for ${playerStats.size} players`);
    }
  } catch (error) {
    console.error("Error loading player stats:", error);
  }
}

function updatePlayerStats(userId, won) {
  if (!playerStats.has(userId)) {
    playerStats.set(userId, { wins: 0, totalGames: 0 });
  }

  const stats = playerStats.get(userId);
  stats.totalGames++;
  if (won) {
    stats.wins++;
  }

  playerStats.set(userId, stats);
  savePlayerStats();
}

function loadGameState() {
  try {
    if (fs.existsSync("game-state.json")) {
      const gameData = JSON.parse(fs.readFileSync("game-state.json", "utf8"));

      // Check if the saved game is from today
      const today = new Date().toDateString();
      if (gameData.date === today && gameData.isActive) {
        currentGame = {
          word: gameData.word,
          guesses: new Map(gameData.guesses),
          date: gameData.date,
          winners: new Set(gameData.winners),
          isActive: gameData.isActive,
          lastGuessTime: gameData.lastGuessTime
            ? new Date(gameData.lastGuessTime)
            : null,
          isCustomWord: gameData.isCustomWord,
          host: gameData.host,
        };

        console.log(
          `Game state restored: ${currentGame.word} (${currentGame.guesses.size} guesses)`
        );
        return true;
      } else {
        console.log("Old game state found, clearing...");
        fs.unlinkSync("game-state.json");
      }
    }
  } catch (error) {
    console.error("Error loading game state:", error);
  }
  return false;
}

// Load word list
let wordList = [];
try {
  const wordsData = fs.readFileSync("words.json", "utf8");
  wordList = JSON.parse(wordsData);
  console.log(`Loaded ${wordList.length} words`);
} catch (error) {
  console.error("Error loading words.json:", error.message);
  console.log("Using default word list...");
  wordList = [
    "APPLE",
    "BRAIN",
    "CRANE",
    "DREAM",
    "FLAME",
    "GRAPE",
    "HOUSE",
    "LASER",
    "MUSIC",
    "PIANO",
  ];
}

// Utility functions
function getRandomWord() {
  return wordList[Math.floor(Math.random() * wordList.length)].toUpperCase();
}

function compareGuess(guess, target) {
  const result = [];
  const targetLetters = target.split("");
  const guessLetters = guess.split("");
  const wordLength = target.length;

  // First pass: mark correct positions
  const targetCounts = {};
  for (let i = 0; i < wordLength; i++) {
    if (guessLetters[i] === targetLetters[i]) {
      result[i] = "🟩"; // Green - correct position
    } else {
      result[i] = null; // Will be filled in second pass
      targetCounts[targetLetters[i]] =
        (targetCounts[targetLetters[i]] || 0) + 1;
    }
  }

  // Second pass: mark wrong positions and misses
  for (let i = 0; i < wordLength; i++) {
    if (result[i] === null) {
      if (targetCounts[guessLetters[i]] && targetCounts[guessLetters[i]] > 0) {
        result[i] = "🟨"; // Yellow - wrong position
        targetCounts[guessLetters[i]]--;
      } else {
        result[i] = "⬜"; // Gray - not in word
      }
    }
  }

  return result.join(""); // Back to original - no spaces between boxes
}

function formatGuessResult(guess, result, isWinner) {
  const letters = guess.split("").join("  "); // Double space to spread across all boxes
  const emoji = isWinner ? "🏆 " : "";
  return `${emoji}**${letters}**\n${result}`;
}

function startNewGame(customWord = null) {
  const today = new Date().toDateString();

  // Don't start a new game if one is already active for today
  if (currentGame.isActive && currentGame.date === today) {
    return false;
  }

  // If there's an old game from yesterday, end it first
  if (currentGame.isActive && currentGame.date !== today) {
    console.log("Ending previous day game to start new one");
    endGame();
  }

  currentGame = {
    word: customWord ? customWord.toUpperCase() : getRandomWord(),
    guesses: new Map(),
    date: today,
    winners: new Set(),
    isActive: true,
    lastGuessTime: null,
    isCustomWord: !!customWord,
    host: customWord ? null : null, // Will be set by the host command
  };

  console.log(
    `New game started! ${
      customWord ? "(Custom word set)" : `Word: ${currentGame.word} (Random)`
    }`
  );

  // Save game state
  saveGameState();
  return true;
}

function endGame() {
  currentGame.isActive = false;

  // Clear saved game state
  try {
    if (fs.existsSync("game-state.json")) {
      fs.unlinkSync("game-state.json");
      console.log("Game state cleared");
    }
  } catch (error) {
    console.error("Error clearing game state:", error);
  }
}

// Bot events
client.once("clientReady", () => {
  console.log(`🎯 ${client.user.tag} is ready for Wordle!`);

  // Load player stats
  loadPlayerStats();

  // Try to restore game state on startup
  const gameRestored = loadGameState();
  if (gameRestored) {
    console.log("Game restored from previous session!");
  } else {
    console.log("No active game found, waiting for 9 AM or commands...");
  }
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();

  // Handle DM responses for custom word hosting
  if (message.guild === null) {
    // DM channel (more reliable than checking type)
    console.log(
      `DM received from ${message.author.username}: "${message.content}"`
    );
    const userId = message.author.id;

    if (pendingHosts.has(userId)) {
      console.log(`Processing custom word from ${message.author.username}`);
      const customWord = message.content.toUpperCase().trim();

      // Validate the word
      if (customWord.length < 3 || customWord.length > 10) {
        message.reply("❌ Word must be 3-10 letters long! Try again.");
        return;
      }

      if (!/^[A-Z]+$/.test(customWord)) {
        message.reply("❌ Word must contain only letters! Try again.");
        return;
      }

      // Get the original channel
      const hostData = pendingHosts.get(userId);
      const channel = client.channels.cache.get(hostData.channelId);

      if (channel && startNewGame(customWord)) {
        // Store the host information
        currentGame.host = userId;

        // Save game state after setting host
        saveGameState();

        const embed = new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle("🎯 Custom Wordle Challenge!")
          .setDescription(
            `${message.author.username} has chosen a **${currentGame.word.length}-letter word** for everyone!\n\nType \`!guess WORD\` to make your guess.\nEveryone gets ONE guess!`
          )
          .addFields(
            {
              name: "Word Pattern",
              value: "_ ".repeat(currentGame.word.length).trim(),
              inline: true,
            },
            { name: "Host", value: message.author.username, inline: true }
          )
          .setFooter({ text: "Good luck everyone! 🍀" });

        channel.send({ embeds: [embed] });
        message.reply(
          "✅ Your custom Wordle game has been started in the server! Good luck to everyone!"
        );

        // Clear the pending request
        pendingHosts.delete(userId);
      } else {
        message.reply(
          "❌ Could not start the game. There might already be an active game today."
        );
        pendingHosts.delete(userId);
      }
      return;
    }
  }

  // Manual start command (for testing or manual games)
  if (content === "!start-wordle") {
    if (startNewGame()) {
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🎯 Daily Wordle Challenge!")
        .setDescription(
          `A new **${currentGame.word.length}-letter word** has been chosen!\n\nType \`!guess WORD\` to make your guess.\nEveryone gets ONE guess!`
        )
        .addFields(
          {
            name: "Word Pattern",
            value: "_ ".repeat(currentGame.word.length).trim(),
            inline: true,
          },
          { name: "Players", value: "Waiting for guesses...", inline: true }
        )
        .setFooter({ text: "Good luck everyone! 🍀" });

      message.channel.send({ embeds: [embed] });
    } else {
      message.reply("❌ A game is already active for today!");
    }
    return;
  }

  // Host custom word command - Step 1: Request to host
  if (content === "!host-wordle") {
    console.log(`${message.author.username} wants to host a custom word game`);

    if (currentGame.isActive) {
      message.reply(
        "❌ A game is already active for today! Use `!end-wordle` to end it first."
      );
      return;
    }

    // Store the pending host request
    pendingHosts.set(message.author.id, {
      channelId: message.channel.id,
      timestamp: new Date(),
    });
    console.log(`Stored pending host request for ${message.author.username}`);

    // DM the user asking for their word
    try {
      await message.author.send(
        "🎯 **Host a Custom Wordle Game!**\n\nPlease reply with your word (3-10 letters). Make sure it contains only letters!\n\nExamples:\n• `CAT` (3 letters)\n• `PIZZA` (5 letters)\n• `ELEPHANT` (8 letters)"
      );
      message.reply(
        "📨 Check your DMs! I've sent you instructions for setting up your custom word."
      );
      console.log(`DM sent successfully to ${message.author.username}`);
    } catch (error) {
      console.log(`Failed to DM ${message.author.username}:`, error.message);
      message.reply(
        "❌ I couldn't send you a DM! Please enable DMs from server members and try again."
      );
      pendingHosts.delete(message.author.id);
    }
    return;
  }

  // Guess command
  if (content.startsWith("!guess ")) {
    // Check if we need to clean up an old game first
    const today = new Date().toDateString();
    if (currentGame.isActive && currentGame.date !== today) {
      console.log("Auto-ending old game from previous day");
      endGame();
    }

    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Wait for the daily game at 9 AM or use `!start-wordle` to start one manually."
      );
      return;
    }

    const guess = content.split(" ")[1]?.toUpperCase();

    if (!guess) {
      message.reply("❌ Please provide a word! Example: `!guess CRANE`");
      return;
    }

    if (guess.length !== currentGame.word.length) {
      message.reply(
        `❌ Word must be exactly ${currentGame.word.length} letters!`
      );
      return;
    }

    if (!/^[A-Z]+$/.test(guess)) {
      message.reply("❌ Word must contain only letters!");
      return;
    }

    const userId = message.author.id;
    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours in milliseconds

    // Check if player already guessed
    if (currentGame.guesses.has(userId)) {
      // Allow re-guess if no one has guessed in the last 2 hours
      if (
        currentGame.lastGuessTime &&
        currentGame.lastGuessTime > twoHoursAgo
      ) {
        message.reply(
          "❌ You already made your guess for today! You can guess again if no one guesses for 2 hours."
        );
        return;
      } else {
        // Remove their old guess to allow a new one
        currentGame.guesses.delete(userId);
        if (currentGame.winners.has(userId)) {
          currentGame.winners.delete(userId);
        }
        message.reply(
          "⏰ 2 hours have passed with no new guesses - you can try again!"
        );

        // Save game state after removing old guess
        saveGameState();
      }
    }

    // Process the guess
    const result = compareGuess(guess, currentGame.word);
    const isWinner = guess === currentGame.word;

    if (isWinner) {
      currentGame.winners.add(userId);
      // Update player stats
      updatePlayerStats(userId, true);
    } else {
      // Still count as a game played
      updatePlayerStats(userId, false);
    }

    // Store guess with timestamp and update last guess time
    const timestamp = new Date();
    currentGame.guesses.set(userId, { guess, result, isWinner, timestamp });
    currentGame.lastGuessTime = timestamp;

    // Save game state after each guess
    saveGameState();

    // Send result
    const embed = new EmbedBuilder()
      .setColor(isWinner ? 0xffd700 : 0x0099ff)
      .setTitle(isWinner ? "🏆 Correct!" : "🎯 Guess Result")
      .setDescription(formatGuessResult(guess, result, isWinner))
      .setFooter({
        text: isWinner ? "Congratulations! 🎉" : "Better luck next time!",
      });

    message.reply({ embeds: [embed] });

    // Auto-end game if someone wins
    if (isWinner) {
      // Wait a moment for the winner message to be seen, then end game
      setTimeout(async () => {
        let description = `**The word was: ${currentGame.word}**\n\n`;

        if (currentGame.winners.size > 0) {
          description += "🏆 **Winners:**\n";
          for (const winnerId of currentGame.winners) {
            try {
              const user = await client.users.fetch(winnerId);
              description += `• ${user.username}\n`;
            } catch (error) {
              console.error("Error fetching winner:", error);
            }
          }
        }

        if (currentGame.guesses.size > 0) {
          description += "\n**All Guesses:**\n";
          for (const [userId, data] of currentGame.guesses) {
            try {
              const user = await client.users.fetch(userId);
              description += `${user.username}: ${formatGuessResult(
                data.guess,
                data.result,
                data.isWinner
              )}\n`;
            } catch (error) {
              console.error("Error fetching user:", error);
            }
          }
        }

        const endEmbed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle("🎯 Game Over!")
          .setDescription(description)
          .setFooter({
            text: "Game ended automatically! Use !start-wordle for a new game.",
          });

        message.channel.send({ embeds: [endEmbed] });
        endGame();
      }, 2000); // 2 second delay
    }

    return;
  }

  // Show time until re-guess is allowed
  if (content === "!wordle-time") {
    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Wait for the daily game at 9 AM or use `!start-wordle` to start one manually."
      );
      return;
    }

    if (!currentGame.lastGuessTime) {
      message.reply(
        "⏰ No guesses yet today - everyone can still make their first guess!"
      );
      return;
    }

    const now = new Date();
    const twoHoursFromLastGuess = new Date(
      currentGame.lastGuessTime.getTime() + 2 * 60 * 60 * 1000
    );
    const timeLeft = twoHoursFromLastGuess - now;

    if (timeLeft <= 0) {
      message.reply(
        "✅ 2 hours have passed! Players who already guessed can try again."
      );
    } else {
      const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
      const minutesLeft = Math.floor(
        (timeLeft % (60 * 60 * 1000)) / (60 * 1000)
      );
      message.reply(
        `⏳ ${hoursLeft}h ${minutesLeft}m until re-guessing is allowed.`
      );
    }
    return;
  }

  // Show player stats
  if (content === "!wordle-stats") {
    if (playerStats.size === 0) {
      message.reply(
        "📊 No player statistics yet! Play some games to see your stats."
      );
      return;
    }

    // Sort players by wins (descending)
    const sortedStats = Array.from(playerStats.entries()).sort(
      (a, b) => b[1].wins - a[1].wins
    );

    let description = "🏆 **Leaderboard**\n\n";

    for (let i = 0; i < Math.min(sortedStats.length, 10); i++) {
      const [userId, stats] = sortedStats[i];
      try {
        const user = await client.users.fetch(userId);
        const winRate =
          stats.totalGames > 0
            ? Math.round((stats.wins / stats.totalGames) * 100)
            : 0;
        const medal =
          i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        description += `${medal} **${user.username}**: ${stats.wins} wins (${winRate}% win rate)\n`;
      } catch (error) {
        console.error("Error fetching user for stats:", error);
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xffd700)
      .setTitle("📊 Wordle Statistics")
      .setDescription(description)
      .setFooter({ text: "Play more games to improve your stats!" });

    message.channel.send({ embeds: [embed] });
    return;
  }

  // Show current game status
  if (content === "!wordle-status") {
    // Check if we need to clean up an old game first
    const today = new Date().toDateString();
    if (currentGame.isActive && currentGame.date !== today) {
      console.log("Auto-ending old game from previous day");
      endGame();
    }

    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Wait for the daily game at 9 AM or use `!start-wordle` to start one manually."
      );
      return;
    }

    let description = `**Word Pattern:** ${"_ "
      .repeat(currentGame.word.length)
      .trim()}\n**Players:** ${currentGame.guesses.size}\n\n`;

    if (currentGame.guesses.size > 0) {
      description += "**Guesses:**\n";
      for (const [userId, data] of currentGame.guesses) {
        const user = await client.users.fetch(userId);
        description += `${user.username}: ${formatGuessResult(
          data.guess,
          data.result,
          data.isWinner
        )}\n`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎯 Current Wordle Game")
      .setDescription(description)
      .setFooter({ text: "Type !guess WORD to play!" });

    message.channel.send({ embeds: [embed] });
    return;
  }

  // End game command (for testing)
  if (content === "!end-wordle") {
    if (!currentGame.isActive) {
      message.reply("❌ No active game to end!");
      return;
    }

    let description = `**The word was: ${currentGame.word}**\n\n`;

    if (currentGame.winners.size > 0) {
      description += "🏆 **Winners:**\n";
      for (const userId of currentGame.winners) {
        const user = await client.users.fetch(userId);
        description += `• ${user.username}\n`;
      }
    } else {
      description += "😔 **No winners today!**\n";
    }

    if (currentGame.guesses.size > 0) {
      description += "\n**All Guesses:**\n";
      for (const [userId, data] of currentGame.guesses) {
        const user = await client.users.fetch(userId);
        description += `${user.username}: ${formatGuessResult(
          data.guess,
          data.result,
          data.isWinner
        )}\n`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("🎯 Game Over!")
      .setDescription(description)
      .setFooter({ text: "Thanks for playing! See you tomorrow at 9 AM! 🌅" });

    message.channel.send({ embeds: [embed] });
    endGame();
    return;
  }

  // Help command
  if (content === "!wordle-help") {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎯 Wordle Bot Commands")
      .setDescription("Welcome to the daily group Wordle game!")
      .addFields(
        {
          name: "!guess WORD",
          value:
            "Make your guess (length matches current word, can re-guess after 2h of no activity)",
          inline: false,
        },
        {
          name: "!wordle-status",
          value: "Show current game status and all guesses",
          inline: false,
        },
        {
          name: "!wordle-time",
          value: "Check time until re-guessing is allowed",
          inline: false,
        },
        {
          name: "!wordle-stats",
          value: "Show player leaderboard and win statistics",
          inline: false,
        },
        {
          name: "!host-wordle",
          value:
            "Host a game with your own word (3-10 letters, bot will DM you for the word)",
          inline: false,
        },
        {
          name: "!start-wordle",
          value: "Start a game with random word",
          inline: false,
        },
        {
          name: "!end-wordle",
          value: "End current game and show results",
          inline: false,
        },
        { name: "!wordle-help", value: "Show this help message", inline: false }
      )
      .addFields({
        name: "How to Play",
        value:
          "🟩 Green: Correct letter in correct position\n🟨 Yellow: Letter is in word but wrong position\n⬜ Gray: Letter not in word",
        inline: false,
      })
      .setFooter({ text: "Daily games start automatically at 9 AM! 🌅" });

    message.channel.send({ embeds: [embed] });
    return;
  }
});

// Schedule daily game at 9 AM
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("🌅 9 AM - Starting daily Wordle game!");

    if (startNewGame()) {
      // Find all channels the bot has access to and send the daily message
      client.guilds.cache.forEach((guild) => {
        // Try to find a general channel or the first text channel available
        const channel =
          guild.channels.cache.find(
            (ch) =>
              ch.name.includes("general") ||
              ch.name.includes("wordle") ||
              ch.name.includes("games") ||
              ch.name.includes("chat")
          ) || guild.channels.cache.filter((ch) => ch.type === 0).first(); // First text channel

        if (channel) {
          const embed = new EmbedBuilder()
            .setColor(0x00ff00)
            .setTitle("🌅 Good Morning! Daily Wordle Time!")
            .setDescription(
              `A new **${currentGame.word.length}-letter word** has been chosen for today!\n\nType \`!guess WORD\` to make your guess.\nEveryone gets ONE guess!`
            )
            .addFields(
              {
                name: "Word Pattern",
                value: "_ ".repeat(currentGame.word.length).trim(),
                inline: true,
              },
              { name: "Time Left", value: "All day!", inline: true }
            )
            .setFooter({
              text: "Good luck everyone! 🍀 Type !wordle-help for commands",
            });

          channel.send({ embeds: [embed] }).catch(console.error);
        }
      });
    }
  },
  {
    scheduled: true,
    timezone: "America/Chicago", // Central Time (St. Louis)
  }
);

// Auto-end game at 11:59 PM
cron.schedule("59 23 * * *", async () => {
  if (currentGame.isActive) {
    console.log("🌙 End of day - Ending Wordle game");

    client.guilds.cache.forEach(async (guild) => {
      const channel =
        guild.channels.cache.find(
          (ch) =>
            ch.name.includes("general") ||
            ch.name.includes("wordle") ||
            ch.name.includes("games") ||
            ch.name.includes("chat")
        ) || guild.channels.cache.filter((ch) => ch.type === 0).first();

      if (channel) {
        let description = `**The word was: ${currentGame.word}**\n\n`;

        if (currentGame.winners.size > 0) {
          description += "🏆 **Today's Winners:**\n";
          for (const userId of currentGame.winners) {
            try {
              const user = await client.users.fetch(userId);
              description += `• ${user.username}\n`;
            } catch (error) {
              console.error("Error fetching user:", error);
            }
          }
        } else {
          description += "😔 **No winners today!**\n";
        }

        const embed = new EmbedBuilder()
          .setColor(0xff6b6b)
          .setTitle("🌙 Daily Wordle Complete!")
          .setDescription(description)
          .setFooter({
            text: "Thanks for playing! See you tomorrow at 9 AM! 🌅",
          });

        channel.send({ embeds: [embed] }).catch(console.error);
      }
    });

    endGame(); // This will also clear the saved game state
  }
});

// Error handling
client.on("error", console.error);

// Login
client.login(process.env.DISCORD_TOKEN);
