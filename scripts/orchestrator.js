// scripts/orchestrator.js

const fs = require('fs');
const path = require('path');
const { trimAfterClass, fixBraces } = require('./auto-fix');
const { fixCodeWithProviders, PROVIDERS } = require('./providers');
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
 * Build error log mein "cannot find symbol class X" aur "package X does not exist" dekhta hai
 * aur AI se missing files generate karwa ke correct path pe save karta hai.
 */
async function generateMissingFiles(dirPath, extractedErrors, projectContext, srcRoot) {
    if (!extractedErrors) return false;

    // Step 1: Missing classes extract karo ("symbol: class X")
    const missingClasses = new Set();
    const classRegex = /symbol:\s+class\s+([A-Z]\w+)/g;
    let match;
    while ((match = classRegex.exec(extractedErrors)) !== null) {
        missingClasses.add(match[1]);
    }

    // Step 2: Missing packages extract karo ("package X.Y.Z does not exist")
    const missingPackages = new Set();
    const pkgRegex = /package\s+([\w\.]+)\s+does not exist/g;
    while ((match = pkgRegex.exec(extractedErrors)) !== null) {
        missingPackages.add(match[1]);
    }

    // Step 3: Jodi missing imports ka mapping nikaalo (konsi class kis package mein chahiye)
    // Existing source files scan karke imports dekhlo
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
        console.log(`[MissingFiles] No missing classes detected.`);
        return false;
    }

    console.log(`[MissingFiles] 🔍 Detected ${missingClasses.size} missing classes: ${[...missingClasses].join(', ')}`);

    // Step 4: Har missing class ke liye AI se file generate karwao
    for (const className of missingClasses) {
        const pkg = importsMap[className] || [...missingPackages][0] || 'com.flickzz.generated.managers';
        const pkgPath = pkg.split('.').join('/');
        const filePath = path.join(srcRoot, pkgPath, `${className}.java`);

        // Skip if file already exists (don't overwrite)
        if (fs.existsSync(filePath)) {
            console.log(`[MissingFiles] ⏭️ ${className}.java already exists, skipping.`);
            continue;
        }

        console.log(`[MissingFiles] 🤖 Generating missing file: ${pkg}.${className}...`);

        const prompt = `You are an expert Minecraft Bukkit/Paper plugin developer.
Generate a complete Java class file for a Minecraft plugin.

REQUIREMENTS:
- Class name: ${className}
- Package: ${pkg}
- File path will be: ${pkgPath}/${className}.java
- Target: PaperMC 1.21.1, Java 21
- This class is referenced by other files but missing. Analyze the imports of the project and guess its purpose from its name.

PROJECT CONTEXT:
${projectContext ? projectContext.substring(0, 2000) : 'N/A'}

CRITICAL RULES:
1. Include proper package declaration: package ${pkg};
2. Include all necessary imports (org.bukkit.*, java.util.*, etc.)
3. Provide complete implementation with common methods (singleton getInstance() if it's a manager, proper fields, constructor)
4. Output ONLY the Java code, no markdown, no explanations.
5. Do NOT include any content after the final closing brace.

Now generate the complete ${className}.java file:`;

        try {
            // Direct provider call (skip the standard fixCodeWithProviders because we want raw generation)
            const result = await fixCodeWithProviders('// New file to generate', `${className}.java`, '', prompt, '');
            if (!result.success || !result.fixedCode) {
                console.warn(`[MissingFiles] ⚠️ Failed to generate ${className}.java`);
                continue;
            }

            let generatedCode = result.fixedCode;

            // Ensure package declaration exists
            if (!generatedCode.includes('package ')) {
                generatedCode = `package ${pkg};\n\n${generatedCode}`;
            }

            // Verify
            const verify = verifyCode(generatedCode, `${className}.java`);
            if (!verify.valid) {
                console.warn(`[MissingFiles] ⚠️ Generated ${className}.java invalid: ${verify.reason}`);
                continue;
            }

            // Ensure folder exists
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, generatedCode, 'utf8');
            console.log(`[MissingFiles] ✅ Created: ${filePath} (${generatedCode.length} chars)`);

        } catch (err) {
            console.error(`[MissingFiles] ❌ Error generating ${className}: ${err.message}`);
        }
    }

    return true;
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

    // 🆕 STEP 1: Missing files generate karo (agar errors mein missing packages hain)
    const srcRoot = path.join(dirPath, 'src', 'main', 'java');
    if (fs.existsSync(srcRoot) && extractedErrors) {
        await generateMissingFiles(dirPath, extractedErrors, projectContext, srcRoot);
    }

    // 🆕 STEP 2: Ab baaki files ko fix karo (import errors ab mostly solve ho jayenge)
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
