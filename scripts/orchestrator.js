// scripts/orchestrator.js

const fs = require('fs');
const path = require('path');
const { trimAfterClass, fixBraces } = require('./auto-fix');
const { fixCodeWithProviders } = require('./providers');

/**
 * Verification Function: Checks if the code is structurally valid.
 */
function verifyCode(code) {
    let openBraces = 0;
    let closeBraces = 0;
    
    for (let char of code) {
        if (char === '{') openBraces++;
        if (char === '}') closeBraces++;
    }
    
    if (openBraces !== closeBraces) {
        return { valid: false, reason: `Unbalanced braces. Open: ${openBraces}, Close: ${closeBraces}` };
    }
    
    if (code.trim().length === 0) {
        return { valid: false, reason: "Code is empty" };
    }

    return { valid: true, reason: "Code looks structurally valid" };
}

/**
 * The Main Agentic Orchestrator Loop
 */
async function processFile(filePath, targetClass = null) {
    console.log(`\n========================================`);
    console.log(`[Orchestrator] 🤖 Starting Agentic Fix for: ${path.basename(filePath)}`);
    console.log(`========================================`);

    if (!fs.existsSync(filePath)) {
        console.error(`[Orchestrator] File not found: ${filePath}`);
        return;
    }

    let code = fs.readFileSync(filePath, 'utf8');
    const fileName = path.basename(filePath);

    // --- PHASE 1: DETERMINISTIC FIXES ---
    console.log(`\n[Orchestrator] Step 1: Applying Deterministic Fixes...`);
    
    if (targetClass) {
        code = trimAfterClass(code, targetClass);
    }
    code = fixBraces(code);

    let verification = verifyCode(code);
    if (verification.valid) {
        console.log(`[Orchestrator] ✅ Deterministic fixes solved the issue! Saving file...`);
        fs.writeFileSync(filePath, code, 'utf8');
        return;
    } else {
        console.log(`[Orchestrator] ⚠️ Deterministic fixes not enough. Reason: ${verification.reason}`);
        console.log(`[Orchestrator] Moving to Agentic AI Loop...`);
    }

    // --- PHASE 2: AGENTIC AI LOOP (With Feedback) ---
    const MAX_RETRIES = 3;
    let feedback = "";

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`\n[Orchestrator] 🧠 AI Attempt ${attempt}/${MAX_RETRIES}...`);
        
        const result = await fixCodeWithProviders(code, fileName, feedback);
        
        if (!result.success) {
            console.error(`[Orchestrator] ❌ AI Provider failed to respond. Retrying...`);
            feedback = "Previous provider failed to respond or threw an API error. Please try again.";
            continue; 
        }

        const aiCode = result.fixedCode;
        const aiVerification = verifyCode(aiCode);

        if (aiVerification.valid) {
            console.log(`[Orchestrator] 🎉 Success! AI produced valid code. Saving file...`);
            fs.writeFileSync(filePath, aiCode, 'utf8');
            return;
        } else {
            console.warn(`[Orchestrator] ⚠️ AI produced invalid code. Reason: ${aiVerification.reason}`);
            console.log(`[Orchestrator] 🔄 Preparing feedback for next attempt...`);
            feedback = `Your previous response had the following structural error: ${aiVerification.reason}. Please fix this exact issue.`;
            code = aiCode; 
        }
    }

    console.error(`\n[Orchestrator] ❌ CRITICAL FAILURE: Could not fix ${fileName} after ${MAX_RETRIES} AI attempts.`);
    console.log(`[Orchestrator] Saving the best attempt (or original code) for manual review...`);
    fs.writeFileSync(filePath + ".broken", code, 'utf8');
}

module.exports = { processFile, verifyCode };
