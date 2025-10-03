const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

class Database {
  constructor() {
    this.client = supabase;
  }

  // Game management functions
  async saveGameState(gameData) {
    try {
      if (!gameData.isActive) {
        return { success: true, message: "Game not active, skipping save" };
      }

      // Check if a game already exists for today
      const { data: existingGame, error: fetchError } = await this.client
        .from("games")
        .select("id")
        .eq("date", gameData.date)
        .eq("is_active", true)
        .single();

      if (fetchError && fetchError.code !== "PGRST116") {
        // PGRST116 = no rows found
        throw fetchError;
      }

      const gameRecord = {
        word: gameData.word,
        date: gameData.date,
        is_active: gameData.isActive,
        is_custom_word: gameData.isCustomWord || false,
        host_user_id: gameData.host || null,
        last_guess_time: gameData.lastGuessTime || null,
        updated_at: new Date().toISOString(),
      };

      let result;
      if (existingGame) {
        // Update existing game
        result = await this.client
          .from("games")
          .update(gameRecord)
          .eq("id", existingGame.id)
          .select();
      } else {
        // Create new game
        result = await this.client.from("games").insert(gameRecord).select();
      }

      if (result.error) {
        throw result.error;
      }

      const gameId = result.data[0].id;

      // Save all guesses for this game
      if (gameData.guesses && gameData.guesses.size > 0) {
        await this.saveGuesses(gameId, gameData.guesses);
      }

      console.log("Game state saved successfully to database");
      return { success: true, gameId };
    } catch (error) {
      console.error("Error saving game state:", error);
      return { success: false, error: error.message };
    }
  }

  async loadGameState() {
    try {
      // Get any active game (regardless of date)
      const { data: game, error: gameError } = await this.client
        .from("games")
        .select("*")
        .eq("is_active", true)
        .single();

      if (gameError) {
        if (gameError.code === "PGRST116") {
          console.log("No active game found");
          return null;
        }
        throw gameError;
      }

      // Get all guesses for this game
      const { data: guesses, error: guessesError } = await this.client
        .from("guesses")
        .select("*")
        .eq("game_id", game.id)
        .order("timestamp", { ascending: true });

      if (guessesError) {
        throw guessesError;
      }

      // Convert database format back to in-memory format
      const guessesMap = new Map();
      const winners = new Set();

      guesses.forEach((guess) => {
        // Initialize array for user if it doesn't exist
        if (!guessesMap.has(guess.user_id)) {
          guessesMap.set(guess.user_id, []);
        }

        // Add guess to user's array
        guessesMap.get(guess.user_id).push({
          guess: guess.guess,
          result: guess.result,
          isWinner: guess.is_winner,
          timestamp: new Date(guess.timestamp),
        });

        if (guess.is_winner) {
          winners.add(guess.user_id);
        }
      });

      const gameState = {
        word: game.word,
        guesses: guessesMap,
        date: game.date,
        winners: winners,
        isActive: game.is_active,
        lastGuessTime: game.last_guess_time
          ? new Date(game.last_guess_time)
          : null,
        isCustomWord: game.is_custom_word,
        host: game.host_user_id,
        gameId: game.id,
      };

      console.log(
        `Game state restored from database: ${gameState.word} (${gameState.guesses.size} guesses)`
      );
      return gameState;
    } catch (error) {
      console.error("Error loading game state:", error);
      return null;
    }
  }

  async saveGuesses(gameId, guessesMap) {
    try {
      // Get existing guesses for this game
      const { data: existingGuesses, error: fetchError } = await this.client
        .from("guesses")
        .select("user_id, timestamp")
        .eq("game_id", gameId);

      if (fetchError) {
        throw fetchError;
      }

      // Create a set of existing guess identifiers
      const existingGuessIds = new Set(
        existingGuesses.map(
          (g) => `${g.user_id}_${new Date(g.timestamp).getTime()}`
        )
      );
      const guessesToInsert = [];

      // Only insert new guesses
      for (const [userId, guessesArray] of guessesMap) {
        for (const guessData of guessesArray) {
          // Create a unique identifier for each guess
          const guessId = `${userId}_${guessData.timestamp.getTime()}`;
          if (!existingGuessIds.has(guessId)) {
            guessesToInsert.push({
              game_id: gameId,
              user_id: userId,
              guess: guessData.guess,
              result: guessData.result,
              is_winner: guessData.isWinner,
              timestamp: guessData.timestamp.toISOString(),
            });
          }
        }
      }

      if (guessesToInsert.length > 0) {
        const { error } = await this.client
          .from("guesses")
          .insert(guessesToInsert);

        if (error) {
          throw error;
        }
      }

      console.log(`Saved ${guessesToInsert.length} new guesses to database`);
    } catch (error) {
      console.error("Error saving guesses:", error);
    }
  }

  async endGame(gameId) {
    try {
      const { error } = await this.client
        .from("games")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", gameId);

      if (error) {
        throw error;
      }

      console.log("Game ended in database");
      return { success: true };
    } catch (error) {
      console.error("Error ending game:", error);
      return { success: false, error: error.message };
    }
  }

  // Player stats functions
  async savePlayerStats(playerStatsMap) {
    try {
      const statsArray = Array.from(playerStatsMap.entries()).map(
        ([userId, stats]) => ({
          user_id: userId,
          wins: stats.wins,
          total_games: stats.totalGames,
          total_guesses: stats.totalGuesses || 0,
          updated_at: new Date().toISOString(),
        })
      );

      // Use upsert to handle both inserts and updates
      const { error } = await this.client
        .from("player_stats")
        .upsert(statsArray, { onConflict: "user_id" });

      if (error) {
        throw error;
      }

      console.log(`Saved stats for ${statsArray.length} players to database`);
      return { success: true };
    } catch (error) {
      console.error("Error saving player stats:", error);
      return { success: false, error: error.message };
    }
  }

  async loadPlayerStats() {
    try {
      const { data, error } = await this.client
        .from("player_stats")
        .select("*");

      if (error) {
        throw error;
      }

      const statsMap = new Map();
      data.forEach((stat) => {
        statsMap.set(stat.user_id, {
          wins: stat.wins,
          totalGames: stat.total_games,
          totalGuesses: stat.total_guesses || 0,
        });
      });

      console.log(`Loaded stats for ${statsMap.size} players from database`);
      return statsMap;
    } catch (error) {
      console.error("Error loading player stats:", error);
      return new Map();
    }
  }

  async updatePlayerStats(userId, won, isNewGame = false) {
    try {
      // First, try to get existing stats
      const { data: existingStats, error: fetchError } = await this.client
        .from("player_stats")
        .select("*")
        .eq("user_id", userId)
        .single();

      let newStats;
      if (fetchError && fetchError.code === "PGRST116") {
        // No existing stats, create new
        newStats = {
          user_id: userId,
          wins: won ? 1 : 0,
          total_games: isNewGame ? 1 : 0,
          total_guesses: 1,
        };
      } else if (fetchError) {
        throw fetchError;
      } else {
        // Update existing stats
        newStats = {
          user_id: userId,
          wins: existingStats.wins + (won ? 1 : 0),
          total_games: existingStats.total_games + (isNewGame ? 1 : 0),
          total_guesses: existingStats.total_guesses + 1,
        };
      }

      const { error } = await this.client
        .from("player_stats")
        .upsert(newStats, { onConflict: "user_id" });

      if (error) {
        throw error;
      }

      console.log(
        `Updated stats for user ${userId}: ${newStats.wins} wins, ${newStats.total_games} games, ${newStats.total_guesses} guesses`
      );
      return { success: true };
    } catch (error) {
      console.error("Error updating player stats:", error);
      return { success: false, error: error.message };
    }
  }

  // Pending hosts functions
  async savePendingHost(userId, channelId) {
    try {
      const { error } = await this.client.from("pending_hosts").upsert(
        {
          user_id: userId,
          channel_id: channelId,
          created_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

      if (error) {
        throw error;
      }

      console.log(`Saved pending host request for user ${userId}`);
      return { success: true };
    } catch (error) {
      console.error("Error saving pending host:", error);
      return { success: false, error: error.message };
    }
  }

  async loadPendingHosts() {
    try {
      const { data, error } = await this.client
        .from("pending_hosts")
        .select("*");

      if (error) {
        throw error;
      }

      const pendingHostsMap = new Map();
      data.forEach((host) => {
        pendingHostsMap.set(host.user_id, {
          channelId: host.channel_id,
          timestamp: new Date(host.created_at),
        });
      });

      console.log(
        `Loaded ${pendingHostsMap.size} pending host requests from database`
      );
      return pendingHostsMap;
    } catch (error) {
      console.error("Error loading pending hosts:", error);
      return new Map();
    }
  }

  async removePendingHost(userId) {
    try {
      const { error } = await this.client
        .from("pending_hosts")
        .delete()
        .eq("user_id", userId);

      if (error) {
        throw error;
      }

      console.log(`Removed pending host request for user ${userId}`);
      return { success: true };
    } catch (error) {
      console.error("Error removing pending host:", error);
      return { success: false, error: error.message };
    }
  }

  // Cleanup functions
  async cleanupOldData() {
    try {
      // Clean up old games (older than 7 days)
      const { error: gamesError } = await this.client
        .from("games")
        .delete()
        .lt(
          "date",
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0]
        );

      if (gamesError) {
        console.error("Error cleaning up old games:", gamesError);
      }

      // Clean up old pending hosts (older than 1 day)
      const { error: hostsError } = await this.client
        .from("pending_hosts")
        .delete()
        .lt(
          "created_at",
          new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        );

      if (hostsError) {
        console.error("Error cleaning up old pending hosts:", hostsError);
      }

      console.log("Database cleanup completed");
      return { success: true };
    } catch (error) {
      console.error("Error during database cleanup:", error);
      return { success: false, error: error.message };
    }
  }

  // Test connection
  async testConnection() {
    try {
      const { data, error } = await this.client
        .from("games")
        .select("count")
        .limit(1);

      if (error) {
        throw error;
      }

      console.log("✅ Database connection successful");
      return { success: true };
    } catch (error) {
      console.error("❌ Database connection failed:", error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new Database();
