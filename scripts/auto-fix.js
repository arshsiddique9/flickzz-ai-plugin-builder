// auto-fix.js

/**
 * Phase 1: Deterministic Fix - Trim extra content after a class
 */
function trimAfterClass(code, className) {
    // Regex to find the class block and trim everything after its closing brace
    const classRegex = new RegExp(`(class\\s+${className}\\s*\\{[^{}]*(?:\\{[^{}]*\\}[^{}]*)*\\})`, 's');
    const match = code.match(classRegex);
    
    if (match && match[1]) {
        console.log(`[Deterministic] Trimmed extra content after class: ${className}`);
        return match[1]; // Return only the class block
    }
    return code; // Return original if class not found or no extra content
}

/**
 * Phase 1: Deterministic Fix - Fix Braces (Skip if balanced)
 */
function fixBraces(code) {
    let openBraces = 0;
    let closeBraces = 0;

    // Count braces (ignoring braces inside strings/comments for simplicity)
    for (let char of code) {
        if (char === '{') openBraces++;
        if (char === '}') closeBraces++;
    }

    if (openBraces === closeBraces) {
        console.log("[Deterministic] Braces are already balanced. Skipping fixBraces.");
        return code; // Skip balanced braces
    }

    console.log(`[Deterministic] Unbalanced braces detected. Open: ${openBraces}, Close: ${closeBraces}. Fixing...`);
    
    // Simple fix: Add missing closing braces at the end
    if (openBraces > closeBraces) {
        const missing = openBraces - closeBraces;
        return code + '\n' + '}'.repeat(missing);
    }
    
    // Note: Removing extra closing braces is risky without AST, so we leave it for AI
    return code; 
}

/**
 * Main Auto-Fix Function (Agentic Flow)
 */
async function autoFix(fileContent, fileName, aiProvider) {
    let fixedContent = fileContent;

    // 1. PRIORITIZE DETERMINISTIC FIXES FIRST
    console.log(`\n--- Starting Auto-Fix for ${fileName} ---`);
    
    // Example: Assuming we want to trim after "MyClass" (you can extract this dynamically)
    fixedContent = trimAfterClass(fixedContent, "MyClass"); 
    fixedContent = fixBraces(fixedContent);

    // 2. AGENTIC BEHAVIOR: Check file size for AI processing
    const MAX_SIZE_FOR_AI = 50000; // 50KB limit
    let contentToSend = fixedContent;
    let isPreview = false;

    if (fixedContent.length > MAX_SIZE_FOR_AI) {
        contentToSend = fixedContent.substring(0, MAX_SIZE_FOR_AI) + "\n\n... [TRUNCATED FOR AI PREVIEW] ...";
        isPreview = true;
        console.log(`[Agentic] Large file detected (${fixedContent.length} bytes). Sending preview to AI.`);
    }

    // 3. CALL AI PROVIDER (Only if deterministic fixes didn't fully solve it)
    // Note: Pass the exact reason for provider failure if it happens
    try {
        console.log(`[Agentic] Sending ${isPreview ? 'preview' : 'full file'} to AI provider...`);
        const aiResponse = await aiProvider.fixCode(contentToSend, fileName, isPreview);
        
        if (aiResponse && aiResponse.fixedCode) {
            fixedContent = aiResponse.fixedCode;
            console.log(`[Agentic] AI successfully fixed the code.`);
        }
    } catch (error) {
        // Phase 3 requirement: Log exact reason for provider failure
        console.error(`[Provider Error] Failed to fix ${fileName} using ${aiProvider.name}. Reason: ${error.message}`);
        console.log(`[Fallback] Returning deterministically fixed code.`);
    }

    return fixedContent;
}

module.exports = { autoFix, trimAfterClass, fixBraces };
