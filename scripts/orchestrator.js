// scripts/orchestrator.js

const fs = require('fs');
const path = require('path');
const { trimAfterClass, fixBraces } = require('./auto-fix');
const { fixCodeWithProviders, generateRawCode } = require('./providers');
const { parseErrorLog } = require('./parse-error');

function verifyCode(code, fileName = '') {
    if (!code || code.trim().length === 0) return { valid: false, reason: "Code is empty" };
    let openBraces = 0, closeBraces = 0;
    for (let char of code) {
        if (char === '{') openBraces++;
        if (char === '}') closeBraces++;
    }
    if (openBraces !== closeBraces) return { valid: false, reason: `Unbalanced braces` };
    if (fileName.endsWith('.java')) {
        if (!/\b(class|interface|enum|record)\s+\w+/.test(code)) {
            return { valid: false, reason: "No class declaration found" };
        }
        if (!code.trim().endsWith('}')) {
            return { valid: false, reason: "File does not end with closing brace" };
        }
    }
    return { valid: true, reason: "OK" };
}

function fileHasError(fileName, extractedErrors) {
    if (!extractedErrors) return false;
    return extractedErrors.toLowerCase().includes(path.basename(fileName).toLowerCase());
}

/**
 * 🆕 MISSING FILE GENERATOR
 * Error log se missing classes detect karta hai aur AI se files generate karwata hai.
 */
async function generateMissingFiles(dirPath, extractedErrors, projectContext, srcRoot) {
    if (!extractedErrors) return false;

    // Step 1: Missing classes ("symbol: class HomeManager")
    const missingClasses = new Set();
    const classRegex = /symbol:\s+class\s+([A-Z]\w+)/g;
    let match;
    while ((match = classRegex.exec(extractedErrors)) !== null) {
        missingClasses.add(match[1]);
    }

    // Step 2: Missing packages ("package X.Y.Z does not exist")
    const missingPackages = new Set();
    const pkgRegex = /package\s+([\w\.]+)\s+does not exist/g;
    while ((match = pkgRegex.exec(extractedErrors)) !== null) {
        missingPackages.add(match[1]);
    }

    // Step 3: Existing files scan karke imports map banao
    const importsMap = {}; // className -> full package path

    function scanImports(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                scanImports(fullPath);
            } else if (entry.name.endsWith('.java')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                for (const cls of missingClasses) {
                    const regex = new RegExp(`import\\s+([\\w\\.]+)\\.${cls};`, 'g');
                    const m = regex.exec(content);
                    if (m) importsMap[cls] = m[1];
                }
            }
        }
    }
    scanImports(srcRoot);

    if (missingClasses.size === 0) {
        console.log(`[MissingFiles] ℹ️ No missing classes detected in error log.`);
        return false;
    }

    console.log(`[MissingFiles] 🔍 Detected ${missingClasses.size} missing classes: ${[...missingClasses].join(', ')}`);
    console.log(`[MissingFiles] 📦 Missing packages: ${[...missingPackages].join(', ') || 'none'}`);

    // Step 4: Har missing class ke liye file generate karo
    let generatedCount = 0;

    for (const className of missingClasses) {
        const pkg = importsMap[className]
                    || [...missingPackages].find(p => p.includes('.')) // closest match
                    || 'com.flickzz.generated.managers';
        const pkgPath = pkg.split('.').join('/');
        const filePath = path.join(srcRoot, pkgPath, `${className}.java`);

        if (fs.existsSync(filePath)) {
            console.log(`[MissingFiles] ⏭️ ${className}.java already exists, skipping.`);
            continue;
        }

        console.log(`[MissingFiles] 🤖 Generating missing file: ${pkg}.${className}...`);

        const prompt = `You are an expert Minecraft Bukkit/Paper plugin developer.

Generate a complete, COMPILABLE Java class file with the following specifications:

**Class Name:** ${className}
**Package:** ${pkg}
**File Path:** ${pkgPath}/${className}.java
**Target:** PaperMC 1.21.1, Java 21, Maven

**Purpose:** This class is referenced by other files in the project but missing. Infer its purpose from its name.
- If it ends with "Manager" (e.g., HomeManager, MessageManager) → it's a utility/manager class with static or instance methods.
- If it ends with "Listener" → it's a Bukkit event listener implementing org.bukkit.event.Listener.
- If it ends with "Command" → it's a command executor implementing CommandExecutor and TabCompleter.
- If it ends with "Config" → it's a config wrapper class.

**Full Project Context (for reference only):**
${projectContext ? projectContext.substring(0, 2500) : 'N/A'}

**CRITICAL RULES:**
1. First line MUST be: package ${pkg};
2. Include ALL necessary imports (org.bukkit.*, java.util.*, etc.)
3. Provide a COMPLETE implementation - no placeholders, no TODO comments
4. If it's a Manager class, include getInstance() singleton pattern
5. Output ONLY Java code, NO markdown fences, NO explanations
6. Last character of output MUST be a closing brace }

Now generate the complete ${className}.java file:`;

        try {
            const result = await generateRawCode(prompt);
            if (!result.success || !result.code) {
                console.warn(`[MissingFiles] ⚠️ Failed to generate ${className}.java`);
                continue;
            }

            let generatedCode = result.code;

            // Ensure package declaration exists
            if (!generatedCode.includes('package ')) {
                generatedCode = `package ${pkg};\n\n${generatedCode}`;
            }

            // Verify
            const verify = verifyCode(generatedCode, `${className}.java`);
            if (!verify.valid) {
                console.warn(`[MissingFiles] ⚠️ Generated ${className}.java invalid: ${verify.reason}`);
                // Try to fix by trimming extra content after class
                generatedCode = trimAfterClass(generatedCode, className);
                const verify2 = verifyCode(generatedCode, `${className}.java`);
                if (!verify2.valid) {
                    console.warn(`[MissingFiles] ❌ Still invalid after trim. Skipping.`);
                    continue;
                }
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, generatedCode, 'utf8');
            generatedCount++;
            console.log(`[MissingFiles] ✅ Created: ${filePath} (${generatedCode.length} chars)`);

        } catch (err) {
            console.error(`[MissingFiles] ❌ Error generating ${className}: ${err.message}`);
        }
    }

    console.log(`[MissingFiles] 📊 Generated ${generatedCount}/${missingClasses.size} missing files.`);
    return generatedCount > 0;
}

async function processFile(filePath, projectContext = "", extractedErrors = "", depContext = "") {
    const fileName = path.basename(filePath);
    console.log(`\n[Orchestrator] 🤖 Fixing: ${fileName}`);
    if (!fs.existsSync(filePath)) return;

    let code = fs.readFileSync(filePath, 'utf8');
    const hasError = fileHasError(fileName, extractedErrors);
    if (hasError) console.log(`[Orchestrator] ⚠️ This file HAS errors in build log. AI will be called.`);

    if (!hasError) {
        const beforeFix = code;
        code = fixBraces(code);
        const verification = verifyCode(code, fileName);
        if (verification.valid && code === beforeFix) {
            console.log(`[Orchestrator] ✅ No issues detected for ${fileName}.`);
            return;
        }
    } else {
        code = fixBraces(code);
    }

    let verification = verifyCode(code, fileName);
    if (verification.valid && !hasError) {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`[Orchestrator] ✅ Deterministic fix successful for ${fileName}.`);
        return;
    }
    if (!verification.valid) console.log(`[Orchestrator] ⚠️ Verification failed: ${verification.reason}`);

    const MAX_RETRIES = 3;
    let feedback = extractedErrors
        ? `Compiler Error Log:\n${extractedErrors}\n\nPlease fix the code based on these errors. IMPORTANT: Do NOT remove or modify any import statements. Keep all existing imports.`
        : "";

    const fullContext = projectContext + depContext;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[Orchestrator] 🧠 AI Attempt ${attempt}/${MAX_RETRIES} for ${fileName}...`);
        const result = await fixCodeWithProviders(code, fileName, fullContext, feedback);
        if (!result.success) {
            feedback = "Previous provider failed to respond. Please try again.";
            continue;
        }

        const aiCode = result.fixedCode;
        if (!aiCode || aiCode.trim().length < 10) {
            feedback = "Your previous response was empty or invalid. Please provide the complete fixed code.";
            continue;
        }

        const aiVerification = verifyCode(aiCode, fileName);
        if (aiVerification.valid) {
            fs.writeFileSync(filePath, aiCode, 'utf8');
            console.log(`[Orchestrator] 🎉 AI successfully fixed ${fileName}!`);
            return;
        } else {
            feedback = `Your previous response had this error: ${aiVerification.reason}. Please fix it.`;
            code = aiCode;
        }
    }

    console.error(`[Orchestrator] ❌ FAILURE for ${fileName} after ${MAX_RETRIES} attempts.`);
    fs.writeFileSync(filePath + ".broken", code, 'utf8');
}

async function processDirectory(dirPath, rawLogPath = "", contextPath = "", depContext = "") {
    console.log(`\n========================================`);
    console.log(`[Orchestrator] 📂 Processing Directory: ${dirPath}`);
    console.log(`========================================`);

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

    // 🆕 STEP 1: Missing files generate karo (sirf TOP level pe)
    const srcRoot = path.join(dirPath, 'src', 'main', 'java');
    if (fs.existsSync(srcRoot) && extractedErrors) {
        await generateMissingFiles(dirPath, extractedErrors, projectContext, srcRoot);
    }

    // 🆕 STEP 2: Baaki files fix karo
    const files = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const file of files) {
        const fullPath = path.join(dirPath, file.name);
        if (file.isDirectory()) {
            await processDirectory(fullPath, rawLogPath, contextPath, depContext);
        } else if (file.name.endsWith('.java')) {
            await processFile(fullPath, projectContext, extractedErrors, depContext);
        }
    }
}

module.exports = { processFile, processDirectory, verifyCode };
