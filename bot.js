const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const database = require("./database");
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

// Database persistence functions
async function saveGameState() {
  if (currentGame.isActive) {
    const gameData = {
      word: currentGame.word,
      guesses: currentGame.guesses,
      date: currentGame.date,
      winners: currentGame.winners,
      isActive: currentGame.isActive,
      lastGuessTime: currentGame.lastGuessTime,
      isCustomWord: currentGame.isCustomWord,
      host: currentGame.host,
    };

    const result = await database.saveGameState(gameData);
    if (result.success && result.gameId) {
      currentGame.gameId = result.gameId;
    }
    return result;
  }
  return { success: true };
}

async function savePlayerStats() {
  return await database.savePlayerStats(playerStats);
}

async function loadPlayerStats() {
  const stats = await database.loadPlayerStats();
  playerStats = stats;
  return stats;
}

async function updatePlayerStats(userId, won, isNewGame = false) {
  const result = await database.updatePlayerStats(userId, won, isNewGame);
  if (result.success) {
    // Update local cache
    if (!playerStats.has(userId)) {
      playerStats.set(userId, { wins: 0, totalGames: 0, totalGuesses: 0 });
    }
    const stats = playerStats.get(userId);
    stats.totalGuesses++;
    if (isNewGame) {
      stats.totalGames++;
    }
    if (won) {
      stats.wins++;
    }
    playerStats.set(userId, stats);
  }
  return result;
}

async function loadGameState() {
  const gameState = await database.loadGameState();
  if (gameState) {
    currentGame = gameState;
    return true;
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
  const letters = guess.split("");
  const boxes = [];

  // Parse emoji boxes
  let i = 0;
  while (i < result.length) {
    const char = result[i];
    if (char === "🟩" || char === "🟨" || char === "⬜") {
      boxes.push(char);
      i++;
    } else {
      // Handle 2-char emojis
      boxes.push(result.substring(i, Math.min(i + 2, result.length)));
      i += 2;
    }
  }

  // Create letters line with single hyphens at ends and between letters
  const letterLine = "**-" + letters.join("-") + "-**"; // Single hyphens throughout

  // Create colored circles line without spacing (compact)
  let circlesLine = "";
  for (let j = 0; j < boxes.length; j++) {
    const box = boxes[j] || "⬜";

    if (box === "🟩") {
      circlesLine += "🟩";
    } else if (box === "🟨") {
      circlesLine += "🟨";
    } else {
      circlesLine += "⬜";
    }
  }

  const emoji = isWinner ? "🏆 " : "";
  return `${emoji}${letterLine}\n${circlesLine}`; // Newline to put circles below letters
}

async function startNewGame(customWord = null) {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
  });

  // Don't start a new game if one is already active
  if (currentGame.isActive) {
    return false;
  }

  currentGame = {
    word: customWord ? customWord.toUpperCase() : getRandomWord(),
    guesses: new Map(), // Will store userId -> array of guesses
    date: today,
    winners: new Set(),
    isActive: true,
    lastGuessTime: null,
    isCustomWord: !!customWord,
    host: customWord ? null : null, // Will be set by the host command
    gameId: null,
  };

  console.log(
    `New game started! ${
      customWord ? "(Custom word set)" : `Word: ${currentGame.word} (Random)`
    }`
  );

  // Save game state to database
  await saveGameState();
  return true;
}

async function endGame() {
  // Update global stats if game was solved (has winners)
  if (currentGame.winners.size > 0 && currentGame.word) {
    // Calculate total guesses from all players
    let totalGuesses = 0;
    for (const [userId, guessesArray] of currentGame.guesses) {
      totalGuesses += guessesArray.length;
    }

    // Update global stats
    await database.updateGlobalStats({
      word: currentGame.word,
      isCustomWord: currentGame.isCustomWord,
      totalGuesses: totalGuesses,
    });
  }

  currentGame.isActive = false;

  // End game in database if we have a gameId
  if (currentGame.gameId) {
    await database.endGame(currentGame.gameId);
  }

  // Clear local game state
  currentGame = {
    word: null,
    guesses: new Map(), // Will store userId -> array of guesses
    date: null,
    winners: new Set(),
    isActive: false,
    lastGuessTime: null,
    isCustomWord: false,
    host: null,
    gameId: null,
  };

  console.log("Game ended and cleared from database");
}

// Bot events
client.once("clientReady", async () => {
  console.log(`🎯 ${client.user.tag} is ready for Wordle!`);

  // Test database connection
  const dbTest = await database.testConnection();
  if (!dbTest.success) {
    console.error(
      "❌ Database connection failed! Bot will continue with limited functionality."
    );
  }

  // Load player stats from database
  await loadPlayerStats();

  // Load pending hosts from database
  const pendingHostsFromDB = await database.loadPendingHosts();
  pendingHosts = pendingHostsFromDB;

  // Try to restore game state on startup
  const gameRestored = await loadGameState();
  if (gameRestored) {
    console.log("Game restored from database!");
  } else {
    console.log("No active game found, waiting for 9 AM or commands...");
  }

  // Clean up old data
  await database.cleanupOldData();
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

      if (channel && (await startNewGame(customWord))) {
        // Store the host information
        currentGame.host = userId;

        // Save game state after setting host
        await saveGameState();

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

        // Clear the pending request from database
        await database.removePendingHost(userId);
        pendingHosts.delete(userId);
      } else {
        message.reply(
          "❌ Could not start the game. There might already be an active game today."
        );
        await database.removePendingHost(userId);
        pendingHosts.delete(userId);
      }
      return;
    }
  }

  // Manual start command (for testing or manual games)
  if (content === "!start-wordle") {
    if (await startNewGame()) {
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🎯 Wordle Challenge!")
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

    // Store the pending host request in database
    const result = await database.savePendingHost(
      message.author.id,
      message.channel.id
    );
    if (result.success) {
      pendingHosts.set(message.author.id, {
        channelId: message.channel.id,
        timestamp: new Date(),
      });
      console.log(`Stored pending host request for ${message.author.username}`);
    }

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
      await database.removePendingHost(message.author.id);
      pendingHosts.delete(message.author.id);
    }
    return;
  }

  // Guess command
  if (content.startsWith("!guess ")) {
    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Use `!start-wordle` to start one manually."
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
    const twoHoursInMs = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

    // Check if player already guessed
    if (
      currentGame.guesses.has(userId) &&
      currentGame.guesses.get(userId).length > 0
    ) {
      // Get the player's most recent guess timestamp
      const playerGuesses = currentGame.guesses.get(userId);
      const lastPlayerGuess = playerGuesses[playerGuesses.length - 1];
      const timeSinceLastGuess = now - new Date(lastPlayerGuess.timestamp);

      // Check if 2 hours have passed since THIS player's last guess
      if (timeSinceLastGuess < twoHoursInMs) {
        const minutesRemaining = Math.ceil(
          (twoHoursInMs - timeSinceLastGuess) / 60000
        );
        message.reply(
          `❌ You already made a guess! You can guess again in ${minutesRemaining} minutes.`
        );
        return;
      } else {
        // Allow re-guess after 2 hours (keep old guess, add new one)
        message.reply(
          "⏰ 2 hours have passed since your last guess - you can try again!"
        );
      }
    }

    // Process the guess
    const result = compareGuess(guess, currentGame.word);
    const isWinner = guess === currentGame.word;
    // Check if this is the first guess in THIS GAME (not first guess ever)
    const isFirstGuessInThisGame =
      !currentGame.guesses.has(userId) ||
      currentGame.guesses.get(userId).length === 0;

    if (isWinner) {
      currentGame.winners.add(userId);
      // Update player stats (count as new game if first guess, otherwise just win)
      await updatePlayerStats(userId, true, isFirstGuessInThisGame);
    } else {
      // Update player stats (count as new game if first guess)
      await updatePlayerStats(userId, false, isFirstGuessInThisGame);
    }

    // Store guess with timestamp and update last guess time
    const timestamp = new Date();

    // Initialize guesses array for user if it doesn't exist
    if (!currentGame.guesses.has(userId)) {
      currentGame.guesses.set(userId, []);
    }

    // Add the new guess to the user's guesses array
    currentGame.guesses
      .get(userId)
      .push({ guess, result, isWinner, timestamp });
    currentGame.lastGuessTime = timestamp;

    // Save game state after each guess
    await saveGameState();

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
          for (const [userId, guessesArray] of currentGame.guesses) {
            try {
              const user = await client.users.fetch(userId);
              for (const guessData of guessesArray) {
                description += `${user.username}: ${formatGuessResult(
                  guessData.guess,
                  guessData.result,
                  guessData.isWinner
                )}\n`;
              }
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
        await endGame();
      }, 2000); // 2 second delay
    }

    return;
  }

  // Show time until re-guess is allowed
  if (content === "!wordle-time") {
    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Use `!start-wordle` to start one manually."
      );
      return;
    }

    const userId = message.author.id;

    // Check if the user has made any guesses
    if (
      !currentGame.guesses.has(userId) ||
      currentGame.guesses.get(userId).length === 0
    ) {
      message.reply(
        "⏰ You haven't guessed yet - you can make your first guess anytime!"
      );
      return;
    }

    // Get the player's most recent guess timestamp
    const playerGuesses = currentGame.guesses.get(userId);
    const lastPlayerGuess = playerGuesses[playerGuesses.length - 1];
    const now = new Date();
    const twoHoursInMs = 2 * 60 * 60 * 1000;
    const timeSinceLastGuess = now - new Date(lastPlayerGuess.timestamp);
    const timeLeft = twoHoursInMs - timeSinceLastGuess;

    if (timeLeft <= 0) {
      message.reply(
        "✅ 2 hours have passed since your last guess! You can guess again."
      );
    } else {
      const hoursLeft = Math.floor(timeLeft / (60 * 60 * 1000));
      const minutesLeft = Math.floor(
        (timeLeft % (60 * 60 * 1000)) / (60 * 1000)
      );
      message.reply(
        `⏳ ${hoursLeft}h ${minutesLeft}m until you can guess again.`
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
        const medal =
          i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
        description += `${medal} **${user.username}**: ${stats.wins} wins, ${stats.totalGames} games, ${stats.totalGuesses} guesses\n`;
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

  // Show global statistics
  if (content === "!global-stats") {
    const stats = await database.getGlobalStats();

    if (!stats || stats.games_solved === 0) {
      message.reply(
        "📊 No global statistics yet! Solve some games to see community stats."
      );
      return;
    }

    let description = `🎯 **Overall Statistics**\n`;
    description += `• Games Solved: ${stats.games_solved}\n`;
    description += `• Total Guesses: ${stats.total_guesses_in_solved_games}\n`;
    description += `• Average Guesses per Solved Game: ${(
      stats.total_guesses_in_solved_games / stats.games_solved
    ).toFixed(1)}\n\n`;

    description += `📊 **By Game Type**\n`;
    if (stats.custom_games_solved > 0) {
      description += `• Custom Games: ${stats.custom_games_solved} solved (${
        stats.custom_guesses_total
      } guesses) - Avg: ${(
        stats.custom_guesses_total / stats.custom_games_solved
      ).toFixed(1)}\n`;
    }
    if (stats.generated_games_solved > 0) {
      description += `• Generated Games: ${
        stats.generated_games_solved
      } solved (${stats.generated_guesses_total} guesses) - Avg: ${(
        stats.generated_guesses_total / stats.generated_games_solved
      ).toFixed(1)}\n`;
    }
    description += `\n`;

    description += `🔤 **By Word Length**\n`;
    const wordLengths = [3, 4, 5, 6, 7, 8];
    for (const length of wordLengths) {
      const solved = stats[`word_length_${length}_solved`];
      const guesses = stats[`word_length_${length}_guesses`];
      if (solved > 0) {
        description += `• ${length} letters: ${solved} solved (${guesses} guesses) - Avg: ${(
          guesses / solved
        ).toFixed(1)}\n`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🌍 Global Wordle Statistics")
      .setDescription(description)
      .setFooter({ text: "Community-wide game analytics!" });

    message.channel.send({ embeds: [embed] });
    return;
  }

  // Show current game status
  if (content === "!wordle-status") {
    if (!currentGame.isActive) {
      message.reply(
        "❌ No active game! Use `!start-wordle` to start one manually."
      );
      return;
    }

    // Calculate total guesses across all players
    let totalGuesses = 0;
    for (const guessesArray of currentGame.guesses.values()) {
      totalGuesses += guessesArray.length;
    }

    let description = `**Word Pattern:** ${"_ "
      .repeat(currentGame.word.length)
      .trim()}\n**Players:** ${
      currentGame.guesses.size
    }\n**Total Guesses:** ${totalGuesses}\n\n`;

    if (currentGame.guesses.size > 0) {
      description += "**Guesses:**\n";
      for (const [userId, guessesArray] of currentGame.guesses) {
        const user = await client.users.fetch(userId);
        for (const guessData of guessesArray) {
          description += `${user.username}: ${formatGuessResult(
            guessData.guess,
            guessData.result,
            guessData.isWinner
          )}\n`;
        }
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
      for (const [userId, guessesArray] of currentGame.guesses) {
        const user = await client.users.fetch(userId);
        for (const guessData of guessesArray) {
          description += `${user.username}: ${formatGuessResult(
            guessData.guess,
            guessData.result,
            guessData.isWinner
          )}\n`;
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("🎯 Game Over!")
      .setDescription(description)
      .setFooter({
        text: "Thanks for playing! Use !start-wordle for a new game! 🌅",
      });

    message.channel.send({ embeds: [embed] });
    await endGame();
    return;
  }

  // Help command
  if (content === "!wordle-help") {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎯 Wordle Bot Commands")
      .setDescription("Welcome to the group Wordle game!")
      .addFields(
        {
          name: "!guess WORD",
          value:
            "Make your guess (length matches current word, can re-guess after 2h from your last guess)",
          inline: false,
        },
        {
          name: "!wordle-status",
          value: "Show current game status and all guesses",
          inline: false,
        },
        {
          name: "!wordle-time",
          value: "Check time until you can re-guess (personal 2-hour cooldown)",
          inline: false,
        },
        {
          name: "!wordle-stats",
          value:
            "Show player leaderboard with wins, games played, and total guesses",
          inline: false,
        },
        {
          name: "!global-stats",
          value:
            "Show community-wide statistics including averages by game type and word length",
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
      .setFooter({
        text: "New games start automatically at 9 AM! Games run indefinitely until solved! 🌅",
      });

    message.channel.send({ embeds: [embed] });
    return;
  }
});

// Schedule daily game at 9 AM
cron.schedule(
  "0 9 * * *",
  async () => {
    console.log("🌅 9 AM - Starting daily Wordle game!");

    if (await startNewGame()) {
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
            .setTitle("🌅 Good Morning! New Wordle Game!")
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

// Removed daily auto-end - games now run until solved or manually ended

// Error handling
client.on("error", console.error);

// Login
client.login(process.env.DISCORD_TOKEN);
