// scripts/orchestrator.js

const fs = require('fs');
const path = require('path');
const { trimAfterClass, fixBraces } = require('./auto-fix');
const { fixCodeWithProviders } = require('./providers');

function verifyCode(code) {
    let openBraces = 0, closeBraces = 0;
    for (let char of code) {
        if (char === '{') openBraces++;
        if (char === '}') closeBraces++;
    }
    if (openBraces !== closeBraces) return { valid: false, reason: `Unbalanced braces. Open: ${openBraces}, Close: ${closeBraces}` };
    if (code.trim().length === 0) return { valid: false, reason: "Code is empty" };
    return { valid: true, reason: "Code looks structurally valid" };
}

/**
 * Process a single file
 */
async function processFile(filePath, targetClass = null, errorLog = "") {
    console.log(`\n[Orchestrator] 🤖 Fixing: ${path.basename(filePath)}`);
    if (!fs.existsSync(filePath)) return;

    let code = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    // Step 1: Deterministic Fixes
    if (targetClass) code = trimAfterClass(code, targetClass);
    code = fixBraces(code);

    let verification = verifyCode(code);
    if (verification.valid) {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`[Orchestrator] ✅ Deterministic fix successful for ${fileName}.`);
        return;
    }

    // Step 2: Agentic AI Loop with Error Log
    const MAX_RETRIES = 3;
    let feedback = errorLog ? `Compiler Error Log:\n${errorLog}\n\nPlease fix the code based on these errors.` : "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[Orchestrator] 🧠 AI Attempt ${attempt}/${MAX_RETRIES} for ${fileName}...`);
        const result = await fixCodeWithProviders(code, fileName, feedback);

        if (!result.success) {
            feedback = "Previous provider failed to respond. Please try again.";
            continue;
        }

        const aiCode = result.fixedCode;
        const aiVerification = verifyCode(aiCode);

        if (aiVerification.valid) {
            fs.writeFileSync(filePath, aiCode, 'utf8');
            console.log(`[Orchestrator] 🎉 AI successfully fixed ${fileName}!`);
            return;
        } else {
            feedback = `Your previous response had structural errors: ${aiVerification.reason}. Fix this.`;
            code = aiCode;
        }
    }

    console.error(`[Orchestrator] ❌ CRITICAL FAILURE for ${fileName}. Saving .broken file.`);
    fs.writeFileSync(filePath + ".broken", code, 'utf8');
}

/**
 * Process an entire directory (Multi-File Support)
 */
async function processDirectory(dirPath, errorLog = "") {
    console.log(`\n========================================`);
    console.log(`[Orchestrator] 📂 Processing Directory: ${dirPath}`);
    console.log(`========================================`);

    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        
        if (file.isDirectory()) {
            // Recursively process subdirectories
            await processDirectory(fullPath, errorLog);
        } else if (file.name.endsWith('.java') || file.name.endsWith('.xml') || file.name.endsWith('.yml')) {
            // Only process relevant source files
            await processFile(fullPath, null, errorLog);
        }
    }
}

module.exports = { processFile, processDirectory, verifyCode };
