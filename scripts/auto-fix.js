// ============================================
// FlickZZ Auto-Fixer Script (v2)
// FIXED: Strict prompt + fallback parser + AI response logging
// ============================================

const fs = require('fs');
const path = require('path');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY;
const TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY;

const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');

console.log(`[Auto-Fix] Working directory: ${PROJECT_DIR}`);
console.log(`[Auto-Fix] Build log: ${ERROR_LOG_FILE}`);

// API Key availability check
console.log('[Auto-Fix] API Key availability:');
console.log(`  DAHL_API_KEY: ${DAHL_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  NARA_API_KEY: ${NARA_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  AGENTROUTER_API_KEY: ${AGENTROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  UNOROUTER_API_KEY: ${UNOROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  TOKENHARBOR_API_KEY: ${TOKENHARBOR_API_KEY ? 'SET' : 'MISSING'}`);

// ═══════════════════════════════════════════
// 1. READ ERROR LOG
// ═══════════════════════════════════════════
function getErrorLog() {
    if (!fs.existsSync(ERROR_LOG_FILE)) return null;
    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');
    console.log(`[Auto-Fix] Build log size: ${log.length} chars`);

    const lines = log.split('\n');
    const errorLines = lines.filter(l =>
        l.includes('[ERROR]') || l.includes('error:') || l.includes('cannot find symbol') || l.includes('.java:[')
    );

    console.log(`[Auto-Fix] Extracted ${errorLines.length} error lines.`);
    if (errorLines.length === 0) return null;
    return errorLines.slice(0, 100).join('\n');
}

// ═══════════════════════════════════════════
// 2. READ ALL PROJECT FILES
// ═══════════════════════════════════════════
function getAllProjectFiles() {
    const files = [];
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const file of fs.readdirSync(dir)) {
            if (file === 'target' || file === '.git' || file === 'build.log') continue;
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) walk(fullPath);
            else if (fullPath.match(/\.(java|xml|yml|yaml|json|properties)$/)) {
                const relativePath = path.relative(PROJECT_DIR, fullPath).replace(/\\/g, '/');
                files.push({ path: relativePath, content: fs.readFileSync(fullPath, 'utf-8') });
            }
        }
    }
    walk(PROJECT_DIR);
    return files;
}

// ═══════════════════════════════════════════
// 3. PARSE FILES FROM AI RESPONSE (with fallback)
// ═══════════════════════════════════════════
function parseFilesFromAI(text) {
    const files = [];

    // Primary parser: <file: path> ... </file>
    const parts = text.split(/<file:\s*/);
    parts.shift();
    for (const part of parts) {
        const lines = part.split('\n');
        let filePath = lines[0].replace(/>.*$/, '').trim();
        let content = lines.slice(1).join('\n').trim();
        content = content.replace(/<\/file>\s*$/, '').trim();
        if (filePath && content) files.push({ path: filePath, content });
    }

    if (files.length > 0) return files;

    // Fallback parser: markdown code blocks with filename
    console.log('[Auto-Fix] Primary parser failed. Trying markdown fallback...');
    const mdRegex = /```(?:java|xml|yaml|yml|json)?\s*\n\s*(?:\/\/|#)\s*([\w\-\.\/]+)\s*\n([\s\S]*?)```/gi;
    let m;
    while ((m = mdRegex.exec(text)) !== null) {
        files.push({ path: m[1].trim(), content: m[2].trim() });
    }

    if (files.length > 0) return files;

    // Fallback 2: Just look for "path/to/file.java" followed by code block
    const mdRegex2 = /```(?:java|xml|yaml|yml|json)?\s*\n([\s\S]*?)```/gi;
    const paths = text.match(/[\w\/\-\.]+\.(?:java|xml|yml|yaml|json)/gi) || [];
    let idx = 0;
    while ((m = mdRegex2.exec(text)) !== null && idx < paths.length) {
        files.push({ path: paths[idx].trim(), content: m[1].trim() });
        idx++;
    }

    return files;
}

// ═══════════════════════════════════════════
// 4. AI CALLER
// ═══════════════════════════════════════════
async function callBestAIModel(prompt) {
    const providers = [
        { name: 'Dahl', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'MiniMaxAI/MiniMax-M2.7' },
        { name: 'Nara', url: 'https://router.bynara.id/v1/chat/completions', key: NARA_API_KEY, model: 'nemotron-3-ultra-free' },
        { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_API_KEY, model: 'nvidia/nemotron-3-ultra-550b-a55b:free', extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' } },
        { name: 'AgentRouter', url: 'https://agentrouter.org/v1/chat/completions', key: AGENTROUTER_API_KEY, model: 'claude-opus-4-8', extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' } },
        { name: 'UNOROUTER', url: 'https://api.unorouter.com/v1/chat/completions', key: UNOROUTER_API_KEY, model: 'nemotron-3-ultra-550b-a55b:free' },
        { name: 'TokenHarbor', url: 'https://api.tokenharbor.ai/v1/chat/completions', key: TOKENHARBOR_API_KEY, model: 'deepseek-v4.1-flash:free' }
    ];

    let attempted = 0;

    for (const p of providers) {
        if (!p.key) {
            console.log(`[Auto-Fix] SKIP ${p.name} — no API key`);
            continue;
        }

        attempted++;
        try {
            console.log(`[Auto-Fix] Trying ${p.name} (${p.model})...`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180000);

            const res = await fetch(p.url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json', ...(p.extra || {}) },
                signal: controller.signal,
                body: JSON.stringify({
                    model: p.model,
                    messages: [
                        { role: 'system', content: 'You are a Java code fixer. You ALWAYS output complete files in <file: path>content</file> format. You NEVER explain. You NEVER use markdown.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 32000
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                const errText = await res.text();
                console.log(`[Auto-Fix] ${p.name} HTTP ${res.status}: ${errText.substring(0, 150)}`);
                continue;
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text) {
                console.log(`[Auto-Fix] ${p.name} returned empty content`);
                continue;
            }

            console.log(`[Auto-Fix] ${p.name} returned ${text.length} chars`);
            // 🔧 DEBUG: Show first 400 chars of AI response
            console.log(`[Auto-Fix] Response preview: ${text.substring(0, 400).replace(/\n/g, ' ⏎ ')}...`);

            const files = parseFilesFromAI(text);

            if (files.length > 0) {
                console.log(`[Auto-Fix] ✅ ${p.name} returned ${files.length} parsed files!`);
                files.forEach(f => console.log(`     - ${f.path}`));
                return files;
            }
            console.log(`[Auto-Fix] ${p.name} returned 0 parsed files. Trying next provider...`);
        } catch (err) {
            console.error(`[Auto-Fix] ${p.name} exception:`, err.message);
        }
    }

    throw new Error(`All ${attempted} AI providers failed`);
}

// ═══════════════════════════════════════════
// 5. MAIN
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED ═══');

    const errorLog = getErrorLog();
    if (!errorLog) { console.log('[Auto-Fix] ❌ No error log.'); process.exit(1); }

    const projectFiles = getAllProjectFiles();
    console.log(`[Auto-Fix] Loaded ${projectFiles.length} project files.`);
    if (projectFiles.length === 0) { console.log('[Auto-Fix] ❌ No project files.'); process.exit(1); }

    const fullFileList = projectFiles.map(f => `<file: ${f.path}>\n${f.content}\n</file>`).join('\n\n');

    // 🔧 STRICTER PROMPT
    const repairPrompt = `You are an expert Java developer. A Minecraft Paper plugin failed to compile.
Fix the errors and return the complete project.

═══════════════════════════════════════════
BUILD ERROR LOG:
═══════════════════════════════════════════
${errorLog}

═══════════════════════════════════════════
CURRENT PROJECT FILES (all ${projectFiles.length} files):
═══════════════════════════════════════════
${fullFileList}

═══════════════════════════════════════════
INSTRUCTIONS (READ CAREFULLY):
═══════════════════════════════════════════
1. Identify the errors from the error log. Common ones:
   - "class, interface, enum, or record expected" → There is EXTRA content after the class closing brace. Delete everything after the last `}` of the main class.
   - "cannot find symbol" → Add missing import at top of the file, OR create the missing class.
   - "package does not exist" → Fix the import path.
2. Fix ONLY the errors. Do NOT change working code.
3. Return EVERY SINGLE FILE, even if you didn't change it.

🚨 OUTPUT FORMAT — THIS IS CRITICAL:
- You MUST output ONLY the files in the following format. Nothing else.
- NO explanations. NO markdown. NO \`\`\`.
- Start each file with <file: path/to/file>
- End each file with </file>

EXAMPLE FORMAT:
<file: src/main/java/com/flickzz/generated/FzWarps.java>
package com.flickzz.generated;
// ... code ...
</file>

<file: pom.xml>
<?xml version="1.0"?>
// ... code ...
</file>

Paper API 1.21.1, Java 21, Package: com.flickzz.generated

NOW OUTPUT ALL ${projectFiles.length} FILES. Start with <file: pom.xml>`;

    try {
        const fixedFiles = await callBestAIModel(repairPrompt);
        console.log(`[Auto-Fix] Writing ${fixedFiles.length} fixed files...`);

        for (const file of fixedFiles) {
            const fullPath = path.join(PROJECT_DIR, file.path);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf-8');
            console.log(`  ✍️  Wrote ${file.path}`);
        }

        console.log('[Auto-Fix] ✅ All files written.');
    } catch (err) {
        console.error('[Auto-Fix] ❌ FATAL:', err.message);
        process.exit(1);
    }
}

main();
