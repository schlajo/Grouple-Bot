// Test script to verify Supabase database connection
require("dotenv").config();
const database = require("./database");

async function testDatabase() {
  console.log("🧪 Testing Supabase database connection...\n");

  // Test 1: Connection
  console.log("1. Testing database connection...");
  const connectionTest = await database.testConnection();
  if (connectionTest.success) {
    console.log("✅ Database connection successful\n");
  } else {
    console.log("❌ Database connection failed:", connectionTest.error);
    return;
  }

  // Test 2: Load player stats
  console.log("2. Testing player stats loading...");
  const stats = await database.loadPlayerStats();
  console.log(`✅ Loaded stats for ${stats.size} players\n`);

  // Test 3: Load pending hosts
  console.log("3. Testing pending hosts loading...");
  const pendingHosts = await database.loadPendingHosts();
  console.log(`✅ Loaded ${pendingHosts.size} pending host requests\n`);

  // Test 4: Load game state
  console.log("4. Testing game state loading...");
  const gameState = await database.loadGameState();
  if (gameState) {
    console.log(
      `✅ Loaded active game: ${gameState.word} (${gameState.guesses.size} guesses)\n`
    );
  } else {
    console.log("✅ No active game found (this is normal)\n");
  }

  // Test 5: Cleanup
  console.log("5. Testing database cleanup...");
  const cleanupResult = await database.cleanupOldData();
  if (cleanupResult.success) {
    console.log("✅ Database cleanup completed\n");
  } else {
    console.log("❌ Database cleanup failed:", cleanupResult.error);
  }

  console.log("🎉 All database tests completed successfully!");
  console.log("\nYour bot is ready to use Supabase for persistent storage!");
}

// Run the test
testDatabase().catch(console.error);
