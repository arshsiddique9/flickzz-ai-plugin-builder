// scripts/orchestrator.js

const fs = require('fs');
const path = require('path');
const { trimAfterClass, fixBraces } = require('./auto-fix');
const { fixCodeWithProviders } = require('./providers');
const { parseErrorLog } = require('./parse-error');

/**
 * 🆕 UPGRADED VERIFIER
 * Sirf brace count nahi, actual Java structure bhi check karta hai.
 */
function verifyCode(code, fileName = '') {
    if (!code || code.trim().length === 0) {
        return { valid: false, reason: "Code is empty" };
    }

    // 1. Brace balance check
    let openBraces = 0, closeBraces = 0;
    for (let char of code) {
        if (char === '{') openBraces++;
        if (char === '}') closeBraces++;
    }
    if (openBraces !== closeBraces) {
        return { valid: false, reason: `Unbalanced braces. Open: ${openBraces}, Close: ${closeBraces}` };
    }

    // 2. 🆕 Java-specific checks (agar .java file hai)
    if (fileName.endsWith('.java')) {
        // Check karo ki file mein kam se kam ek class/interface/enum ho
        const hasClassDecl = /\b(class|interface|enum|record)\s+\w+/.test(code);
        if (!hasClassDecl) {
            return { valid: false, reason: "No class/interface/enum/record declaration found" };
        }

        // Check karo ki class ke bahar extra content toh nahi hai
        // Simplified: Last non-whitespace character must be `}` 
        const trimmed = code.trim();
        if (!trimmed.endsWith('}')) {
            return { valid: false, reason: "File does not end with closing brace (extra content after class?)" };
        }

        // 🆕 Check: Koi bhi line jo class ke bahar ho (heuristic)
        // Count karo kitni baar 'class X {' aur matching '}' hai
        // Simplified heuristic: agar file mein "class " ke baad kuch random text hai, detect karo
        const lines = code.split('\n');
        let classDepth = 0;
        let foundClassEnd = false;
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // Agar class khatam ho gayi aur uske baad koi non-empty, non-comment line hai
            if (foundClassEnd && line.trim().length > 0 && 
                !line.trim().startsWith('//') && 
                !line.trim().startsWith('/*') &&
                !line.trim().startsWith('*')) {
                return { valid: false, reason: `Extra content detected after class (line ${i + 1}): ${line.trim().substring(0, 50)}` };
            }
        }
    }

    // 3. 🆕 General check: File mein koi obvious garbage nahi hona chahiye
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(code)) {
        return { valid: false, reason: "File contains invalid control characters" };
    }

    return { valid: true, reason: "Code looks structurally valid" };
}

/**
 * 🆕 Check karo ki current file ka error build log mein hai ya nahi
 */
function fileHasError(fileName, extractedErrors) {
    if (!extractedErrors) return false;
    // Bas file ka naam check karo (case-insensitive)
    const baseName = path.basename(fileName);
    return extractedErrors.toLowerCase().includes(baseName.toLowerCase());
}

/**
 * Process a single file
 */
async function processFile(filePath, projectContext = "", extractedErrors = "", depContext = "") {
    const fileName = path.basename(filePath);
    console.log(`\n[Orchestrator] 🤖 Fixing: ${fileName}`);
    
    if (!fs.existsSync(filePath)) return;

    let code = fs.readFileSync(filePath, 'utf8');

    // 🆕 Check karo ki is file ka error hai ya nahi
    const hasError = fileHasError(fileName, extractedErrors);
    if (hasError) {
        console.log(`[Orchestrator] ⚠️ This file HAS errors in build log. AI will be called.`);
    }

    // Step 1: Deterministic Fixes (sirf tab apply karo jab error na ho)
    if (!hasError) {
        const beforeFix = code;
        code = fixBraces(code);
        const verification = verifyCode(code, fileName);
        
        if (verification.valid && code === beforeFix) {
            console.log(`[Orchestrator] ✅ Deterministic check passed, no AI needed for ${fileName}.`);
            return;
        }
    } else {
        // 🆕 Agar error hai, toh deterministic fix try karo, par AI ko BHI call karo
        console.log(`[Orchestrator] 🔧 Applying deterministic fixes first...`);
        code = fixBraces(code);
    }

    // Step 2: Verify after deterministic
    let verification = verifyCode(code, fileName);
    if (verification.valid && !hasError) {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`[Orchestrator] ✅ Deterministic fix successful for ${fileName}.`);
        return;
    }

    if (!verification.valid) {
        console.log(`[Orchestrator] ⚠️ Verification failed: ${verification.reason}`);
    }

    // Step 3: AI Loop (ALWAYS run if hasError, or if verification failed)
    const MAX_RETRIES = 3;
    let feedback = extractedErrors 
        ? `Compiler Error Log:\n${extractedErrors}\n\nPlease fix the code based on these errors.` 
        : "";
    
    if (hasError && !feedback) {
        feedback = `This file has errors in the build log. Please review and fix any issues.`;
    }

    const fullContext = projectContext + depContext;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[Orchestrator] 🧠 AI Attempt ${attempt}/${MAX_RETRIES} for ${fileName}...`);
        
        const result = await fixCodeWithProviders(code, fileName, fullContext, feedback);

        if (!result.success) {
            console.warn(`[Orchestrator] ⚠️ Provider returned no result, retrying...`);
            feedback = "Previous provider failed to respond. Please try again.";
            continue;
        }

        const aiCode = result.fixedCode;

        // AI ne empty ya garbage return kiya?
        if (!aiCode || aiCode.trim().length < 10) {
            console.warn(`[Orchestrator] ⚠️ AI returned empty/garbage code. Retrying...`);
            feedback = "Your previous response was empty or invalid. Please provide the complete fixed code.";
            continue;
        }

        const aiVerification = verifyCode(aiCode, fileName);

        if (aiVerification.valid) {
            fs.writeFileSync(filePath, aiCode, 'utf8');
            console.log(`[Orchestrator] 🎉 AI successfully fixed ${fileName}! (${aiCode.length} chars)`);
            return;
        } else {
            console.warn(`[Orchestrator] ⚠️ AI output invalid: ${aiVerification.reason}`);
            feedback = `Your previous response had this error: ${aiVerification.reason}. Please fix it and return ONLY valid Java code.`;
            code = aiCode; // AI ke attempt ko base banao
        }
    }

    console.error(`[Orchestrator] ❌ CRITICAL FAILURE for ${fileName} after ${MAX_RETRIES} AI attempts.`);
    fs.writeFileSync(filePath + ".broken", code, 'utf8');
}

/**
 * Process an entire directory
 */
async function processDirectory(dirPath, rawLogPath = "", contextPath = "", depContext = "") {
    console.log(`\n========================================`);
    console.log(`[Orchestrator] 📂 Processing Directory: ${dirPath}`);
    console.log(`========================================`);

    // Skip target/ and node_modules/
    if (dirPath.includes('target') || dirPath.includes('node_modules') || dirPath.includes('.git')) {
        console.log(`[Orchestrator] ⏭️ Skipping: ${dirPath}`);
        return;
    }

    let projectContext = "No project context available.";
    if (contextPath && fs.existsSync(contextPath)) {
        projectContext = fs.readFileSync(contextPath, 'utf8');
    }

    let extractedErrors = "";
    if (rawLogPath && fs.existsSync(rawLogPath)) {
        extractedErrors = parseErrorLog(rawLogPath);
    }

    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        
        if (file.isDirectory()) {
            await processDirectory(fullPath, rawLogPath, contextPath, depContext);
        } else if (file.name.endsWith('.java')) {
            // 🆕 Sirf .java files pe AI call karo (pom.xml, yml skip karo)
            await processFile(fullPath, projectContext, extractedErrors, depContext);
        }
    }
}

module.exports = { processFile, processDirectory, verifyCode };
