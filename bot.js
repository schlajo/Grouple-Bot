const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const cron = require("node-cron");
const fs = require("fs");
const http = require("http");
const database = require("./database");
require("dotenv").config();

// Enable selective debug logging (exclude token info)
process.env.DEBUG = "discord.js:gateway,discord.js:shard";

// Bot setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// HTTP server for Render health checks (Web Service requires a port)
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Grouple Bot is running!");
});
server.listen(PORT, () => {
  console.log(`✅ Health check server running on port ${PORT}`);
});

// Game state - now per guild
let guildGames = new Map(); // guildId -> game object

// Pending host requests - now per guild
let guildPendingHosts = new Map(); // guildId -> Map(userId -> {channelId, timestamp})

// Win tracking - now per guild
let guildPlayerStats = new Map(); // guildId -> Map(userId -> {wins, totalGames, totalGuesses})

// Helper function to get or create game state for a guild
function getGuildGame(guildId) {
  if (!guildGames.has(guildId)) {
    guildGames.set(guildId, {
      word: null,
      guesses: new Map(),
      date: null,
      winners: new Set(),
      isActive: false,
      lastGuessTime: null,
      isCustomWord: false,
      host: null,
      gameId: null,
    });
  }
  return guildGames.get(guildId);
}

// Helper function to get or create pending hosts for a guild
function getGuildPendingHosts(guildId) {
  if (!guildPendingHosts.has(guildId)) {
    guildPendingHosts.set(guildId, new Map());
  }
  return guildPendingHosts.get(guildId);
}

// Helper function to get or create player stats for a guild
function getGuildPlayerStats(guildId) {
  if (!guildPlayerStats.has(guildId)) {
    guildPlayerStats.set(guildId, new Map());
  }
  return guildPlayerStats.get(guildId);
}

// Database persistence functions
async function saveGameState(guildId) {
  const currentGame = getGuildGame(guildId);
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

    const result = await database.saveGameState(gameData, guildId);
    if (result.success && result.gameId) {
      currentGame.gameId = result.gameId;
    }
    return result;
  }
  return { success: true };
}

async function savePlayerStats(guildId) {
  const playerStats = getGuildPlayerStats(guildId);
  return await database.savePlayerStats(playerStats, guildId);
}

async function loadPlayerStats(guildId) {
  const stats = await database.loadPlayerStats(guildId);
  guildPlayerStats.set(guildId, stats);
  return stats;
}

async function updatePlayerStats(guildId, userId, won, isNewGame = false) {
  const result = await database.updatePlayerStats(
    userId,
    guildId,
    won,
    isNewGame
  );
  if (result.success) {
    // Update local cache
    const playerStats = getGuildPlayerStats(guildId);
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

async function loadGameState(guildId) {
  const gameState = await database.loadGameState(guildId);
  if (gameState) {
    guildGames.set(guildId, gameState);
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

  // Create letters line with dots between letters
  const letterLine = "**" + letters.join(" · ") + "**"; // Middots between letters only

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
  return { letterLine: `${emoji}${letterLine}`, circlesLine };
}

async function startNewGame(guildId, customWord = null) {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
  });

  const currentGame = getGuildGame(guildId);

  // Don't start a new game if one is already active
  if (currentGame.isActive) {
    return false;
  }

  const newGame = {
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

  guildGames.set(guildId, newGame);

  console.log(
    `New game started in guild ${guildId}! ${
      customWord ? "(Custom word set)" : `Word: ${newGame.word} (Random)`
    }`
  );

  // Save game state to database
  await saveGameState(guildId);
  return true;
}

async function endGame(guildId) {
  const currentGame = getGuildGame(guildId);

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
  guildGames.set(guildId, {
    word: null,
    guesses: new Map(),
    date: null,
    winners: new Set(),
    isActive: false,
    lastGuessTime: null,
    isCustomWord: false,
    host: null,
    gameId: null,
  });

  console.log(`Game ended in guild ${guildId} and cleared from database`);
}

// Bot events
client.once("ready", async () => {
  console.log(`🎯 ${client.user.tag} is ready for Grouple!`);

  // Test database connection
  const dbTest = await database.testConnection();
  if (!dbTest.success) {
    console.error(
      "❌ Database connection failed! Bot will continue with limited functionality."
    );
  }

  // Load player stats and game state for all guilds the bot is in
  for (const [guildId, guild] of client.guilds.cache) {
    console.log(`Loading data for guild: ${guild.name} (${guildId})`);

    // Load player stats from database
    await loadPlayerStats(guildId);

    // Load pending hosts from database
    const pendingHostsFromDB = await database.loadPendingHosts(guildId);
    guildPendingHosts.set(guildId, pendingHostsFromDB);

    // Try to restore game state on startup
    const gameRestored = await loadGameState(guildId);
    if (gameRestored) {
      console.log(`Game restored for guild ${guild.name}!`);
    } else {
      console.log(`No active game found for guild ${guild.name}`);
    }
  }

  console.log("All guilds loaded. Waiting for 9 AM or commands...");

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

    // Check all guilds for pending host requests from this user
    for (const [guildId, pendingHosts] of guildPendingHosts) {
      if (pendingHosts.has(userId)) {
        console.log(
          `Processing custom word from ${message.author.username} for guild ${guildId}`
        );
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

        if (channel && (await startNewGame(guildId, customWord))) {
          // Store the host information
          const currentGame = getGuildGame(guildId);
          currentGame.host = userId;

          // Save game state after setting host
          await saveGameState(guildId);

          const embed = new EmbedBuilder()
            .setColor(0xffd700)
            .setTitle("🎯 Custom Grouple Challenge!")
            .setDescription(
              `${message.author.username} has chosen a **${currentGame.word.length}-letter word** for everyone!\n\nType \`!guess WORD\` to make your guess.`
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
            "✅ Your custom Grouple game has been started in the server! Good luck to everyone!"
          );

          // Clear the pending request from database
          await database.removePendingHost(userId, guildId);
          pendingHosts.delete(userId);
        } else {
          message.reply(
            "❌ Could not start the game. There might already be an active game today."
          );
          await database.removePendingHost(userId, guildId);
          pendingHosts.delete(userId);
        }
        return;
      }
    }
  }

  // Manual start command (for testing or manual games)
  if (content === "!start-wordle") {
    const guildId = message.guild.id;
    if (await startNewGame(guildId)) {
      const currentGame = getGuildGame(guildId);
      const embed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle("🎯 Grouple Challenge!")
        .setDescription(
          `A new **${currentGame.word.length}-letter word** has been chosen!\n\nType \`!guess WORD\` to make your guess.`
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
    const guildId = message.guild.id;
    const currentGame = getGuildGame(guildId);
    const pendingHosts = getGuildPendingHosts(guildId);

    console.log(
      `${message.author.username} wants to host a custom word game in guild ${guildId}`
    );

    if (currentGame.isActive) {
      message.reply(
        "❌ A game is already active for today! Use `!end-wordle` to end it first."
      );
      return;
    }

    // Store the pending host request in database
    const result = await database.savePendingHost(
      message.author.id,
      guildId,
      message.channel.id
    );
    if (result.success) {
      pendingHosts.set(message.author.id, {
        channelId: message.channel.id,
        timestamp: new Date(),
      });
      console.log(
        `Stored pending host request for ${message.author.username} in guild ${guildId}`
      );
    }

    // DM the user asking for their word
    try {
      await message.author.send(
        "🎯 **Host a Custom Grouple Game!**\n\nPlease reply with your word (3-10 letters). Make sure it contains only letters!\n\nExamples:\n• `CAT` (3 letters)\n• `PIZZA` (5 letters)\n• `ELEPHANT` (8 letters)"
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
      await database.removePendingHost(message.author.id, guildId);
      pendingHosts.delete(message.author.id);
    }
    return;
  }

  // Guess command
  if (content.startsWith("!guess ")) {
    const guildId = message.guild.id;
    const currentGame = getGuildGame(guildId);

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
    const oneHourInMs = 1 * 60 * 60 * 1000; // 1 hour in milliseconds

    // Check if player already guessed
    if (
      currentGame.guesses.has(userId) &&
      currentGame.guesses.get(userId).length > 0
    ) {
      // Get the player's most recent guess timestamp
      const playerGuesses = currentGame.guesses.get(userId);
      const lastPlayerGuess = playerGuesses[playerGuesses.length - 1];
      const timeSinceLastGuess = now - new Date(lastPlayerGuess.timestamp);

      // Check if 1 hour has passed since THIS player's last guess
      if (timeSinceLastGuess < oneHourInMs) {
        const minutesRemaining = Math.ceil(
          (oneHourInMs - timeSinceLastGuess) / 60000
        );
        message.reply(
          `❌ You already made a guess! You can guess again in ${minutesRemaining} minutes.`
        );
        return;
      } else {
        // Allow re-guess after 1 hour (keep old guess, add new one)
        message.reply(
          "⏰ 1 hour has passed since your last guess - you can try again!"
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
      await updatePlayerStats(guildId, userId, true, isFirstGuessInThisGame);
    } else {
      // Update player stats (count as new game if first guess)
      await updatePlayerStats(guildId, userId, false, isFirstGuessInThisGame);
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
    await saveGameState(guildId);

    // Send result
    const embed = new EmbedBuilder()
      .setColor(isWinner ? 0xffd700 : 0x0099ff)
      .setTitle(isWinner ? "🏆 Correct!" : "🎯 Guess Result")
      .setDescription((() => {
        const { letterLine, circlesLine } = formatGuessResult(guess, result, isWinner);
        return `${letterLine}\n${circlesLine}`;
      })())
      .setFooter({
        text: isWinner ? "Congratulations! 🎉" : "Better luck next time!",
      });

    message.reply({ embeds: [embed] });

    // Auto-end game if someone wins
    if (isWinner) {
      // Wait a moment for the winner message to be seen, then end game
      setTimeout(async () => {
        const gameToEnd = getGuildGame(guildId);
        let description = `**The word was: ${gameToEnd.word}**\n\n`;

        if (gameToEnd.winners.size > 0) {
          description += "🏆 **Winners:**\n";
          for (const winnerId of gameToEnd.winners) {
            try {
              const user = await client.users.fetch(winnerId);
              description += `• ${user.username}\n`;
            } catch (error) {
              console.error("Error fetching winner:", error);
            }
          }
        }

        if (gameToEnd.guesses.size > 0) {
          description += "\n**All Guesses:**\n";
          for (const [userId, guessesArray] of gameToEnd.guesses) {
            try {
              const user = await client.users.fetch(userId);
              for (const guessData of guessesArray) {
                const { letterLine, circlesLine } = formatGuessResult(
                  guessData.guess,
                  guessData.result,
                  guessData.isWinner
                );
                description += `${letterLine}  by ${user.username}\n${circlesLine}\n`;
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
        await endGame(guildId);
      }, 2000); // 2 second delay
    }

    return;
  }

  // Show time until re-guess is allowed
  if (content === "!wordle-time") {
    const guildId = message.guild.id;
    const currentGame = getGuildGame(guildId);

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
    const oneHourInMs = 1 * 60 * 60 * 1000;
    const timeSinceLastGuess = now - new Date(lastPlayerGuess.timestamp);
    const timeLeft = oneHourInMs - timeSinceLastGuess;

    if (timeLeft <= 0) {
      message.reply(
        "✅ 1 hour has passed since your last guess! You can guess again."
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
    const guildId = message.guild.id;
    const playerStats = getGuildPlayerStats(guildId);

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

    for (let i = 0; i < Math.min(sortedStats.length, 25); i++) {
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
      .setTitle("📊 Grouple Statistics")
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
    const wordLengths = [3, 4, 5, 6, 7, 8, 9, 10];
    const wordStats = await database.getWordStatsByLength();

    for (const length of wordLengths) {
      const solved = stats[`word_length_${length}_solved`];
      const guesses = stats[`word_length_${length}_guesses`];
      if (solved > 0) {
        description += `• ${length} letters: ${solved} solved (${guesses} guesses) - Avg: ${(
          guesses / solved
        ).toFixed(1)}`;

        // Add most/least guessed words if available
        const lengthStats = wordStats[length];
        if (lengthStats) {
          const parts = [];
          if (lengthStats.mostGuesses) {
            parts.push(
              `Most: ${lengthStats.mostGuesses.word} (${lengthStats.mostGuesses.guesses})`
            );
          }
          if (lengthStats.leastGuesses) {
            parts.push(
              `Least: ${lengthStats.leastGuesses.word} (${lengthStats.leastGuesses.guesses})`
            );
          }
          if (parts.length > 0) {
            description += ` | ${parts.join(", ")}`;
          }
        }
        description += `\n`;
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle("🌍 Global Grouple Statistics")
      .setDescription(description)
      .setFooter({ text: "Community-wide game analytics!" });

    message.channel.send({ embeds: [embed] });
    return;
  }

  // Show current game status
  if (content === "!wordle-status") {
    const guildId = message.guild.id;
    const currentGame = getGuildGame(guildId);

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
          const { letterLine, circlesLine } = formatGuessResult(
            guessData.guess,
            guessData.result,
            guessData.isWinner
          );
          description += `${letterLine}  by ${user.username}\n${circlesLine}\n`;
        }
      }
    }

    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎯 Current Grouple Game")
      .setDescription(description)
      .setFooter({ text: "Type !guess WORD to play!" });

    message.channel.send({ embeds: [embed] });
    return;
  }

  // End game command (for testing)
  if (content === "!end-wordle") {
    const guildId = message.guild.id;
    const currentGame = getGuildGame(guildId);

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
          const { letterLine, circlesLine } = formatGuessResult(
            guessData.guess,
            guessData.result,
            guessData.isWinner
          );
          description += `${letterLine}  by ${user.username}\n${circlesLine}\n`;
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
    await endGame(guildId);
    return;
  }

  // Help command
  if (content === "!wordle-help") {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle("🎯 Grouple Bot Commands")
      .setDescription("Welcome to the group Grouple game!")
      .addFields(
        {
          name: "!guess WORD",
          value:
            "Make your guess (length matches current word, can re-guess after 1h from your last guess)",
          inline: false,
        },
        {
          name: "!wordle-status",
          value: "Show current game status and all guesses",
          inline: false,
        },
        {
          name: "!wordle-time",
          value: "Check time until you can re-guess (personal 1-hour cooldown)",
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
        text: "Use !start-wordle or !host-wordle to start a new game! Games run indefinitely until solved! 🌅",
      });

    message.channel.send({ embeds: [embed] });
    return;
  }
});

// Removed daily auto-start - games now started manually with !start-wordle or !host-wordle
// Removed daily auto-end - games now run until solved or manually ended

// Error handling and debug events
client.on("error", (error) => console.error("Client error:", error));
client.on("warn", (warning) => console.warn("Client warning:", warning));
client.on("invalidated", () => console.error("Client session invalidated!"));
client.on("shardError", (error) => console.error("Shard error:", error));
client.on("shardDisconnect", (event, id) =>
  console.log("Shard disconnected:", id, event)
);
client.on("shardReconnecting", (id) => console.log("Shard reconnecting:", id));

// Critical: Monitor IDENTIFY completion
client.on("debug", (msg) => {
  if (
    msg.includes("IDENTIFY") ||
    msg.includes("READY") ||
    msg.includes("hello")
  ) {
    console.log("Gateway:", msg);
  }
});

// Login
const token = process.env.DISCORD_TOKEN?.trim();
console.log("Attempting to connect to Discord...");

if (!token) {
  console.error("❌ DISCORD_TOKEN environment variable is not set!");
} else {
  // Set a timeout to detect hanging login
  const loginTimeout = setTimeout(() => {
    console.error(
      "⚠️ Login is taking too long (>30s) - connection may be blocked or token invalid"
    );
  }, 30000);

  client
    .login(token)
    .then(() => {
      clearTimeout(loginTimeout);
      console.log("Discord login initiated successfully");
    })
    .catch((error) => {
      clearTimeout(loginTimeout);
      console.error("❌ Failed to login to Discord:", error.message);
      console.error("Full error:", error);
    });
}

// Catch any unhandled errors
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});
