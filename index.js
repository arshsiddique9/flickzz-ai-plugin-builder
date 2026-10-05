// index.js

const { processDirectory } = require('./scripts/orchestrator');
const { researchDependencies } = require('./scripts/researcher'); // 🆕 Researcher Agent
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

// 1. Run Researcher Agent to find dependencies
const detectedDeps = researchDependencies(dirPath);
let depContext = "";
if (detectedDeps.length > 0) {
    depContext = `\n\n[RESEARCHER AGENT REPORT]\nDetected External Dependencies: ${detectedDeps.join(', ')}\nEnsure these are properly imported and available in pom.xml.`;
}

// 2. Process Directory with Orchestrator
processDirectory(dirPath, logPath, contextPath, depContext)
    .then(() => console.log("\n✅ Agentic Fix Process Completed."))
    .catch(err => {
        console.error("\n❌ Unexpected Error:", err);
        process.exit(1);
    });
