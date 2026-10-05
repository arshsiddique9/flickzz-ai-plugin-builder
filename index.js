// index.js

const { processDirectory } = require('./scripts/orchestrator');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dirPath = args[0] || './plugin-src';
const logPath = args[1]; // build.log path
const contextPath = args[2]; // project-context.json path

if (!fs.existsSync(dirPath)) {
    console.error(`❌ Directory not found: ${dirPath}`);
    process.exit(1);
}

console.log(`[CLI] Starting Agentic Engine...`);
console.log(`[CLI] Target Directory: ${dirPath}`);
console.log(`[CLI] Build Log: ${logPath || 'Not provided'}`);
console.log(`[CLI] Context File: ${contextPath || 'Not provided'}`);

processDirectory(dirPath, logPath, contextPath)
    .then(() => console.log("\n✅ Agentic Fix Process Completed."))
    .catch(err => {
        console.error("\n❌ Unexpected Error:", err);
        process.exit(1);
    });
