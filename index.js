// index.js

const { processDirectory } = require('./scripts/orchestrator');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dirPath = args[0] || './plugin-src';
const logPath = args[1]; // Build log ka path

let errorLog = "";
if (logPath && fs.existsSync(logPath)) {
    errorLog = fs.readFileSync(logPath, 'utf8');
    console.log(`[CLI] Loaded build log from ${logPath}`);
}

if (!fs.existsSync(dirPath)) {
    console.error(`❌ Directory not found: ${dirPath}`);
    process.exit(1);
}

processDirectory(dirPath, errorLog)
    .then(() => console.log("\n✅ Agentic Fix Process Completed."))
    .catch(err => {
        console.error("\n❌ Unexpected Error:", err);
        process.exit(1);
    });
