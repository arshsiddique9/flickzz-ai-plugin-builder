// scripts/agents.js

/**
 * PLANNER AGENT PROMPT
 * Yeh AI ko project ka pura structure aur context deta hai.
 */
function getPlannerPrompt(projectContext, errorLog, fileName) {
    return `
You are the PLANNER AGENT for a Minecraft Plugin Builder.
Your job is to analyze the project structure and the build error to create a precise fix plan.

--- PROJECT CONTEXT ---
${projectContext || "No context available."}

--- BUILD ERROR LOG ---
${errorLog || "No specific error log provided."}

--- TARGET FILE ---
${fileName}

Based on the above, explain briefly what the root cause of the error might be and what needs to be fixed. Do not write the full code yet. Just plan.
`;
}

/**
 * CODER/FIXER AGENT PROMPT
 * Yeh AI se exact code fix karwata hai.
 */
function getFixerPrompt(projectContext, errorLog, fileName, currentCode, plan = "") {
    return `
You are the CODER AGENT for a Minecraft Plugin Builder.
Your job is to fix the code in the file: ${fileName}.

${plan ? `--- PLANNER'S PLAN ---\n${plan}\n` : ""}

--- PROJECT CONTEXT (Dependencies & Structure) ---
${projectContext || "No context available."}

--- BUILD ERROR LOG ---
${errorLog || "No specific error log provided."}

--- CURRENT BROKEN CODE ---
${currentCode}

INSTRUCTIONS:
1. Fix the errors shown in the build log.
2. Ensure the code matches the project structure (check package names, imports).
3. Output ONLY the fully corrected code. No markdown, no explanations.
`;
}

module.exports = { getPlannerPrompt, getFixerPrompt };
