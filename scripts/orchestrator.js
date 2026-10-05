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
 * 🆕 MISSING FILE GENERATOR v2
 * 1. Error log ki line numbers se missing imports detect karta hai
 * 2. Original file padh kar exact class name nikalta hai
 * 3. AI se missing files generate karta hai
 */
async function generateMissingFiles(dirPath, rawLogPath, projectContext, srcRoot) {
    if (!rawLogPath || !fs.existsSync(rawLogPath)) return false;

    const rawLog = fs.readFileSync(rawLogPath, 'utf8');
    const missingImports = new Map(); // className -> package

    // ═══════════════════════════════════════════
    // METHOD 1: Line-number based detection (BEST)
    // Format: [ERROR] /path/File.java:[4,38] package X.Y.Z does not exist
    // ═══════════════════════════════════════════
    const lineBasedRegex = /\[ERROR\]\s+([^\s:]+\.java):\[(\d+),\d+\]\s+package\s+([\w\.]+)\s+does not exist/g;
    let m;
    while ((m = lineBasedRegex.exec(rawLog)) !== null) {
        const sourceFile = m[1];
        const lineNum = parseInt(m[2]);
        const pkg = m[3];

        if (!fs.existsSync(sourceFile)) continue;

        const lines = fs.readFileSync(sourceFile, 'utf8').split('\n');
        const lineContent = lines[lineNum - 1] || '';

        // Extract FQN from import line
        const importMatch = lineContent.match(/^\s*import\s+([\w\.]+);/);
        if (importMatch) {
            const fqn = importMatch[1];
            const className = fqn.split('.').pop();
            if (className && /^[A-Z]/.test(className)) {
                missingImports.set(className, pkg);
                console.log(`[MissingFiles] 📌 Line ${lineNum}: Detected missing import ${pkg}.${className}`);
            }
        }
    }

    // ═══════════════════════════════════════════
    // METHOD 2: "symbol: class X" detection (backup)
    // ═══════════════════════════════════════════
    const symbolRegex = /symbol:\s+class\s+([A-Z]\w+)/g;
    while ((m = symbolRegex.exec(rawLog)) !== null) {
        const className = m[1];
        if (!missingImports.has(className)) {
            // Find which package it should be in by scanning existing files
            let foundPkg = null;
            const scanDir = (dir) => {
                if (foundPkg || !fs.existsSync(dir)) return;
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const e of entries) {
                    const fp = path.join(dir, e.name);
                    if (e.isDirectory()) scanDir(fp);
                    else if (e.name.endsWith('.java')) {
                        const content = fs.readFileSync(fp, 'utf8');
                        const im = content.match(new RegExp(`import\\s+([\\w\\.]+)\\.${className};`));
                        if (im) { foundPkg = im[1]; return; }
                    }
                }
            };
            scanDir(srcRoot);
            if (foundPkg) missingImports.set(className, foundPkg);
        }
    }

    // ═══════════════════════════════════════════
    // METHOD 3: Scan all files for imports to non-existent packages
    // ═══════════════════════════════════════════
    function scanAllImports(dir) {
        if (!fs.existsSync(dir)) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
            const fp = path.join(dir, e.name);
            if (e.isDirectory()) scanAllImports(fp);
            else if (e.name.endsWith('.java')) {
                const content = fs.readFileSync(fp, 'utf8');
                const importRegex = /^\s*import\s+(com\.flickzz\.[\w\.]+);/gm;
                let im;
                while ((im = importRegex.exec(content)) !== null) {
                    const fqn = im[1];
                    const parts = fqn.split('.');
                    const className = parts.pop();
                    const pkg = parts.join('.');
                    
                    // Check karo agar class file exist karti hai
                    const expectedPath = path.join(srcRoot, pkg.split('.').join('/'), `${className}.java`);
                    if (!fs.existsSync(expectedPath) && !missingImports.has(className)) {
                        missingImports.set(className, pkg);
                        console.log(`[MissingFiles] 📌 Scan: Detected missing import ${pkg}.${className}`);
                    }
                }
            }
        }
    }
    scanAllImports(srcRoot);

    if (missingImports.size === 0) {
        console.log(`[MissingFiles] ℹ️ No missing classes detected.`);
        return false;
    }

    console.log(`[MissingFiles] 🔍 Total missing classes: ${missingImports.size}`);
    for (const [cls, pkg] of missingImports.entries()) {
        console.log(`[MissingFiles]    - ${pkg}.${cls}`);
    }

    // ═══════════════════════════════════════════
    // Generate all missing files
    // ═══════════════════════════════════════════
    let generatedCount = 0;

    for (const [className, pkg] of missingImports.entries()) {
        const pkgPath = pkg.split('.').join('/');
        const filePath = path.join(srcRoot, pkgPath, `${className}.java`);

        if (fs.existsSync(filePath)) {
            console.log(`[MissingFiles] ⏭️ ${className}.java already exists.`);
            continue;
        }

        console.log(`[MissingFiles] 🤖 Generating: ${pkg}.${className}...`);

        const prompt = `You are an expert Minecraft Bukkit/Paper plugin developer.

Generate a COMPLETE, COMPILABLE Java class file.

**Class Name:** ${className}
**Package:** ${pkg}
**Target:** PaperMC 1.21.1, Java 21

**Infer purpose from name:**
- Ending in "Manager" (HomeManager, MessageManager, CooldownManager) → utility/manager class with singleton getInstance(), methods to manage data
- Ending in "Listener" (PlayerListener) → implements org.bukkit.event.Listener with @EventHandler methods
- Ending in "Command" (HomeCommand) → implements CommandExecutor, TabCompleter
- Ending in "Utils"/"Handler" → utility class with static methods
- Ending in "Config" → config wrapper class

**Project Context:**
${projectContext ? projectContext.substring(0, 2000) : 'N/A'}

**STRICT RULES:**
1. First line MUST be: package ${pkg};
2. Include ALL necessary imports (org.bukkit.*, java.util.*)
3. NO placeholders, NO TODO — complete implementation
4. If Manager class: include private static instance + getInstance() + constructor
5. Output ONLY Java code — no markdown, no explanations
6. Last character MUST be }

Generate complete ${className}.java:`;

        try {
            const result = await generateRawCode(prompt);
            if (!result.success || !result.code) {
                console.warn(`[MissingFiles] ⚠️ Generation failed for ${className}`);
                continue;
            }

            let generatedCode = result.code;

            if (!generatedCode.match(/^\s*package\s+/)) {
                generatedCode = `package ${pkg};\n\n${generatedCode}`;
            }

            let verify = verifyCode(generatedCode, `${className}.java`);
            if (!verify.valid) {
                console.warn(`[MissingFiles] ⚠️ Invalid: ${verify.reason} — attempting trim...`);
                generatedCode = trimAfterClass(generatedCode, className);
                verify = verifyCode(generatedCode, `${className}.java`);
                if (!verify.valid) {
                    console.warn(`[MissingFiles] ❌ Still invalid. Skipping.`);
                    continue;
                }
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, generatedCode, 'utf8');
            generatedCount++;
            console.log(`[MissingFiles] ✅ Created: ${pkgPath}/${className}.java (${generatedCode.length} chars)`);

        } catch (err) {
            console.error(`[MissingFiles] ❌ Error: ${err.message}`);
        }
    }

    console.log(`[MissingFiles] 📊 Generated ${generatedCount}/${missingImports.size} files.`);
    return generatedCount > 0;
}

async function processFile(filePath, projectContext = "", extractedErrors = "", depContext = "") {
    const fileName = path.basename(filePath);
    console.log(`\n[Orchestrator] 🤖 Fixing: ${fileName}`);
    if (!fs.existsSync(filePath)) return;

    let code = fs.readFileSync(filePath, 'utf8');
    const hasError = fileHasError(fileName, extractedErrors);
    if (hasError) console.log(`[Orchestrator] ⚠️ This file HAS errors in build log.`);

    if (!hasError) {
        const beforeFix = code;
        code = fixBraces(code);
        const verification = verifyCode(code, fileName);
        if (verification.valid && code === beforeFix) {
            console.log(`[Orchestrator] ✅ No issues for ${fileName}.`);
            return;
        }
    } else {
        code = fixBraces(code);
    }

    let verification = verifyCode(code, fileName);
    if (verification.valid && !hasError) {
        fs.writeFileSync(filePath, code, 'utf8');
        console.log(`[Orchestrator] ✅ Deterministic fix: ${fileName}.`);
        return;
    }
    if (!verification.valid) console.log(`[Orchestrator] ⚠️ Verification failed: ${verification.reason}`);

    const MAX_RETRIES = 3;
    let feedback = extractedErrors
        ? `Compiler Error Log:\n${extractedErrors}\n\nFix the code. IMPORTANT: Do NOT remove any import statements. Keep all imports intact.`
        : "";

    const fullContext = projectContext + depContext;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        console.log(`[Orchestrator] 🧠 AI Attempt ${attempt}/${MAX_RETRIES} for ${fileName}...`);
        const result = await fixCodeWithProviders(code, fileName, fullContext, feedback);
        if (!result.success) {
            feedback = "Previous provider failed. Try again.";
            continue;
        }

        const aiCode = result.fixedCode;
        if (!aiCode || aiCode.trim().length < 10) {
            feedback = "Response was empty. Provide complete code.";
            continue;
        }

        const aiVerification = verifyCode(aiCode, fileName);
        if (aiVerification.valid) {
            fs.writeFileSync(filePath, aiCode, 'utf8');
            console.log(`[Orchestrator] 🎉 AI fixed ${fileName}!`);
            return;
        } else {
            feedback = `Previous response error: ${aiVerification.reason}. Fix it.`;
            code = aiCode;
        }
    }

    console.error(`[Orchestrator] ❌ FAILURE for ${fileName}.`);
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

    // STEP 1: Missing files detect + generate (TOP LEVEL ONLY)
    const srcRoot = path.join(dirPath, 'src', 'main', 'java');
    const isTopLevel = dirPath === './plugin-src' || path.basename(dirPath) === 'plugin-src';
    
    if (isTopLevel && fs.existsSync(srcRoot) && rawLogPath) {
        await generateMissingFiles(dirPath, rawLogPath, projectContext, srcRoot);
    }

    // STEP 2: Process files
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
