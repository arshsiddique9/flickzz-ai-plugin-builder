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
 */
async function generateMissingFiles(dirPath, rawLogPath, projectContext, srcRoot) {
    if (!rawLogPath || !fs.existsSync(rawLogPath)) return false;

    const rawLog = fs.readFileSync(rawLogPath, 'utf8');
    const missingImports = new Map(); 

    // Line-number based detection
    const lineBasedRegex = /\[ERROR\]\s+([^\s:]+\.java):\[(\d+),\d+\]\s+package\s+([\w\.]+)\s+does not exist/g;
    let m;
    while ((m = lineBasedRegex.exec(rawLog)) !== null) {
        const sourceFile = m[1];
        const lineNum = parseInt(m[2]);
        const pkg = m[3];

        if (!fs.existsSync(sourceFile)) continue;

        const lines = fs.readFileSync(sourceFile, 'utf8').split('\n');
        const lineContent = lines[lineNum - 1] || '';

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

    if (missingImports.size === 0) {
        console.log(`[MissingFiles] ℹ️ No missing classes detected.`);
        return false;
    }

    console.log(`[MissingFiles] 🔍 Total missing classes: ${missingImports.size}`);
    let generatedCount = 0;

    for (const [className, pkg] of missingImports.entries()) {
        const pkgPath = pkg.split('.').join('/');
        const filePath = path.join(srcRoot, pkgPath, `${className}.java`);

        if (fs.existsSync(filePath)) continue;

        console.log(`[MissingFiles] 🤖 Generating: ${pkg}.${className}...`);

        const prompt = `You are an expert Minecraft Bukkit/Paper plugin developer.
Generate a COMPLETE, COMPILABLE Java class file.

**Class Name:** ${className}
**Package:** ${pkg}
**Target:** PaperMC 1.21.1, Java 21

**Infer purpose from name:**
- Manager -> utility/manager class with singleton getInstance()
- Listener -> implements org.bukkit.event.Listener
- Command -> implements CommandExecutor, TabCompleter
- Utils/Handler -> utility class with static methods

**Project Context:**
${projectContext ? projectContext.substring(0, 2000) : 'N/A'}

**STRICT RULES:**
1. First line MUST be: package ${pkg};
2. Include ALL necessary imports
3. NO placeholders, NO TODO
4. Output ONLY Java code — no markdown
5. Last character MUST be }
`;

        try {
            const result = await generateRawCode(prompt);
            if (!result.success || !result.code) continue;

            let generatedCode = result.code;
            if (!generatedCode.match(/^\s*package\s+/)) {
                generatedCode = `package ${pkg};\n\n${generatedCode}`;
            }

            let verify = verifyCode(generatedCode, `${className}.java`);
            if (!verify.valid) {
                generatedCode = trimAfterClass(generatedCode, className);
                verify = verifyCode(generatedCode, `${className}.java`);
                if (!verify.valid) continue;
            }

            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, generatedCode, 'utf8');
            generatedCount++;
            console.log(`[MissingFiles] ✅ Created: ${pkgPath}/${className}.java`);

        } catch (err) {
            console.error(`[MissingFiles] ❌ Error: ${err.message}`);
        }
    }
    return generatedCount > 0;
}

async function processFile(filePath, projectContext = "", extractedErrors = "", depContext = "") {
    const fileName = path.basename(filePath);
    console.log(`\n[Orchestrator] 🤖 Fixing: ${fileName}`);
    if (!fs.existsSync(filePath)) return;

    let code = fs.readFileSync(filePath, 'utf8');
    const hasError = fileHasError(fileName, extractedErrors);

    if (!hasError) {
        const beforeFix = code;
        code = fixBraces(code);
        const verification = verifyCode(code, fileName);
        if (verification.valid && code === beforeFix) return;
    } else {
        code = fixBraces(code);
    }

    let verification = verifyCode(code, fileName);
    if (verification.valid && !hasError) {
        fs.writeFileSync(filePath, code, 'utf8');
        return;
    }

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
    console.log(`\n[Orchestrator] 📂 Processing Directory: ${dirPath}`);
    if (dirPath.includes('target') || dirPath.includes('node_modules') || dirPath.includes('.git')) return;

    let projectContext = "No project context available.";
    if (contextPath && fs.existsSync(contextPath)) {
        projectContext = fs.readFileSync(contextPath, 'utf8');
    }

    let extractedErrors = "";
    if (rawLogPath && fs.existsSync(rawLogPath)) {
        extractedErrors = parseErrorLog(rawLogPath);
    }

    const srcRoot = path.join(dirPath, 'src', 'main', 'java');
    const isTopLevel = dirPath === './plugin-src' || path.basename(dirPath) === 'plugin-src';
    
    if (isTopLevel && fs.existsSync(srcRoot) && rawLogPath) {
        await generateMissingFiles(dirPath, rawLogPath, projectContext, srcRoot);
    }

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
