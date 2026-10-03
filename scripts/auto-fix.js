// ============================================
// FlickZZ Auto-Fixer Script (Runs on GitHub Actions)
// FIXED: Uses CWD (plugin-src) for correct paths + better error extraction + detailed logging
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
console.log(`[Auto-Fix] Looking for build log at: ${ERROR_LOG_FILE}`);

// 🔧 Debug: Check which API keys are available
console.log('[Auto-Fix] API Key availability:');
console.log(`  DAHL_API_KEY: ${DAHL_API_KEY ? 'SET (' + DAHL_API_KEY.length + ' chars)' : 'MISSING'}`);
console.log(`  NARA_API_KEY: ${NARA_API_KEY ? 'SET (' + NARA_API_KEY.length + ' chars)' : 'MISSING'}`);
console.log(`  OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  AGENTROUTER_API_KEY: ${AGENTROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  UNOROUTER_API_KEY: ${UNOROUTER_API_KEY ? 'SET' : 'MISSING'}`);
console.log(`  TOKENHARBOR_API_KEY: ${TOKENHARBOR_API_KEY ? 'SET' : 'MISSING'}`);

// ═══════════════════════════════════════════
// 1. READ ERROR LOG
// ═══════════════════════════════════════════
function getErrorLog() {
    if (!fs.existsSync(ERROR_LOG_FILE)) {
        console.log(`[Auto-Fix] ❌ build.log NOT FOUND`);
        return null;
    }
    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');
    console.log(`[Auto-Fix] Build log size: ${log.length} chars`);

    const lines = log.split('\n');
    const errorLines = lines.filter(l =>
        l.includes('[ERROR]') ||
        l.includes('error:') ||
        l.includes('cannot find symbol') ||
        l.includes('.java:[')
    );

    console.log(`[Auto-Fix] Extracted ${errorLines.length} error lines.`);

    if (errorLines.length === 0) return null;

    // Take up to 100 error lines (avoid huge prompts)
    return errorLines.slice(0, 100).join('\n');
}

// ═══════════════════════════════════════════
// 2. READ ALL PROJECT FILES
// ═══════════════════════════════════════════
function getAllProjectFiles() {
    const files = [];
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const list = fs.readdirSync(dir);
        for (const file of list) {
            if (file === 'target' || file === '.git' || file === 'build.log') continue;
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walk(fullPath);
            } else {
                if (!fullPath.match(/\.(java|xml|yml|yaml|json|properties)$/)) continue;
                const relativePath = path.relative(PROJECT_DIR, fullPath).replace(/\\/g, '/');
                const content = fs.readFileSync(fullPath, 'utf-8');
                files.push({ path: relativePath, content });
            }
        }
    }
    walk(PROJECT_DIR);
    return files;
}

// ═══════════════════════════════════════════
// 3. AI CALLER (with detailed logging)
// ═══════════════════════════════════════════
async function callBestAIModel(prompt) {
    const providers = [
        { name: 'Dahl', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'MiniMaxAI/MiniMax-M2.7' },
        { name: 'Dahl-DeepSeek', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'deepseek-ai/DeepSeek-V4-Flash-0731' },
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
            const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 min

            const res = await fetch(p.url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${p.key}`,
                    'Content-Type': 'application/json',
                    ...(p.extra || {})
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: p.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 32000
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                const errText = await res.text();
                console.log(`[Auto-Fix] ${p.name} HTTP ${res.status}: ${errText.substring(0, 200)}`);
                continue;
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text) {
                console.log(`[Auto-Fix] ${p.name} returned empty content`);
                continue;
            }

            console.log(`[Auto-Fix] ${p.name} returned ${text.length} chars`);

            const files = [];
            const parts = text.split(/<file:\s*/);
            parts.shift();
            for (const part of parts) {
                const lines = part.split('\n');
                let filePath = lines[0].replace(/>.*$/, '').trim();
                let content = lines.slice(1).join('\n').trim();
                content = content.replace(/<\/file>\s*$/, '').trim();
                if (filePath && content) files.push({ path: filePath, content });
            }

            if (files.length > 0) {
                console.log(`[Auto-Fix] ✅ ${p.name} returned ${files.length} fixed files!`);
                return files;
            }
            console.log(`[Auto-Fix] ${p.name} returned 0 parsed files`);
        } catch (err) {
            console.error(`[Auto-Fix] ${p.name} exception:`, err.message);
        }
    }

    throw new Error(`All ${attempted} AI providers failed`);
}

// ═══════════════════════════════════════════
// 4. MAIN AUTO-FIX FLOW
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED ═══');

    const errorLog = getErrorLog();
    if (!errorLog) {
        console.log('[Auto-Fix] ❌ No usable error log.');
        process.exit(1);
    }

    const projectFiles = getAllProjectFiles();
    console.log(`[Auto-Fix] Loaded ${projectFiles.length} project files.`);

    if (projectFiles.length === 0) {
        console.log('[Auto-Fix] ❌ No project files found.');
        process.exit(1);
    }

    const fullFileList = projectFiles.map(f => `<file: ${f.path}>\n${f.content}\n</file>`).join('\n\n');

    const repairPrompt = `You are an expert Java developer fixing a Minecraft Paper plugin that failed to compile in Maven.

BUILD ERROR LOG:
${errorLog}

ALL PROJECT FILES:
${fullFileList}

CRITICAL FIXING INSTRUCTIONS:
1. Read the error log carefully. Each line shows: FILE_PATH:[LINE,COL] ERROR_MESSAGE
2. Common Java errors:
   - "cannot find symbol" → Add missing import at top of file, OR create missing class if it doesn't exist.
   - "class, interface, enum, or record expected" → The file has EXTRA content after the main class's closing brace. Find the LAST closing brace of the main class and DELETE everything after it. This usually means a method wasn't closed properly or there's duplicate code.
   - "package X does not exist" → Fix the import path.
   - "incompatible types" → Fix variable assignments.
   - "method X cannot be applied to given types" → Fix method calls.
   - "variable X might not have been initialized" → Initialize it.
3. Fix ONLY the reported errors. Do NOT refactor unrelated code.
4. CRITICAL: Return EVERY file in the project, even unchanged ones.
5. Return files in this EXACT format (no markdown, no explanation):

<file: path/to/file>
content
</file>

Paper API 1.21.1, Java 21, Package: com.flickzz.generated`;

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
