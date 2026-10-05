// index.js

const { processFile } = require('./scripts/orchestrator');
const path = require('path');

// Command line arguments se file path aur target class lo
const args = process.argv.slice(2);
const filePath = args[0];
const targetClass = args[1] || null;

if (!filePath) {
    console.error("❌ Usage: node index.js <path-to-file> [targetClassName]");
    process.exit(1);
}

// Process start karo
processFile(filePath, targetClass)
    .then(() => console.log("\n✅ Process Completed."))
    .catch(err => console.error("\n❌ Unexpected Error:", err));
