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

  // First pass: mark correct positions
  const targetCounts = {};
  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === targetLetters[i]) {
      result[i] = "🟩"; // Green - correct position
    } else {
      result[i] = null; // Will be filled in second pass
      targetCounts[targetLetters[i]] =
        (targetCounts[targetLetters[i]] || 0) + 1;
    }
  }

  // Second pass: mark wrong positions and misses
  for (let i = 0; i < 5; i++) {
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
  const letters = guess.split("").join("  "); // Double space to spread across all 5 boxes
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
  return true;
}

function endGame() {
  currentGame.isActive = false;
}

// Bot events
client.once("clientReady", () => {
  console.log(`🎯 ${client.user.tag} is ready for Wordle!`);
  console.log("Bot is online and waiting for 9 AM or commands...");
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
      if (customWord.length !== 5) {
        message.reply("❌ Word must be exactly 5 letters! Try again.");
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

        const embed = new EmbedBuilder()
          .setColor(0xffd700)
          .setTitle("🎯 Custom Wordle Challenge!")
          .setDescription(
            `${message.author.username} has chosen a word for everyone!\n\nType \`!guess WORD\` to make your guess.\nEveryone gets ONE guess!`
          )
          .addFields(
            { name: "Word Pattern", value: "_ _ _ _ _", inline: true },
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
          "A new 5-letter word has been chosen!\n\nType `!guess WORD` to make your guess.\nEveryone gets ONE guess!"
        )
        .addFields(
          { name: "Word Pattern", value: "_ _ _ _ _", inline: true },
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
        "🎯 **Host a Custom Wordle Game!**\n\nPlease reply with your 5-letter word. Make sure it's exactly 5 letters and contains only letters!\n\nExample: Just type `PIZZA`"
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

    if (guess.length !== 5) {
      message.reply("❌ Word must be exactly 5 letters!");
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
      }
    }

    // Process the guess
    const result = compareGuess(guess, currentGame.word);
    const isWinner = guess === currentGame.word;

    if (isWinner) {
      currentGame.winners.add(userId);
    }

    // Store guess with timestamp and update last guess time
    const timestamp = new Date();
    currentGame.guesses.set(userId, { guess, result, isWinner, timestamp });
    currentGame.lastGuessTime = timestamp;

    // Send result
    const embed = new EmbedBuilder()
      .setColor(isWinner ? 0xffd700 : 0x0099ff)
      .setTitle(isWinner ? "🏆 Correct!" : "🎯 Guess Result")
      .setDescription(formatGuessResult(guess, result, isWinner))
      .setFooter({
        text: isWinner ? "Congratulations! 🎉" : "Better luck next time!",
      });

    message.reply({ embeds: [embed] });

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

    let description = `**Word Pattern:** _ _ _ _ _\n**Players:** ${currentGame.guesses.size}\n\n`;

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
            "Make your guess (5 letters, can re-guess after 2h of no activity)",
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
          name: "!host-wordle",
          value:
            "Host a game with your own word (bot will DM you for the word)",
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
              "A new 5-letter word has been chosen for today!\n\nType `!guess WORD` to make your guess.\nEveryone gets ONE guess!"
            )
            .addFields(
              { name: "Word Pattern", value: "_ _ _ _ _", inline: true },
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

    endGame();
  }
});

// Error handling
client.on("error", console.error);

// Login
client.login(process.env.DISCORD_TOKEN);
