// ============================================
// FlickZZ Auto-Fixer Script (Runs on GitHub Actions)
// FIXED: Uses CWD (plugin-src) for correct paths + better error extraction
// ============================================

const fs = require('fs');
const path = require('path');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY;
const TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY;

// 🔧 FIX: Workflow runs `cd plugin-src` then `node ../scripts/auto-fix.js`
// So CWD is already plugin-src. Use it directly.
const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');

console.log(`[Auto-Fix] Working directory: ${PROJECT_DIR}`);
console.log(`[Auto-Fix] Looking for build log at: ${ERROR_LOG_FILE}`);

// ═══════════════════════════════════════════
// 1. READ ERROR LOG
// ═══════════════════════════════════════════
function getErrorLog() {
    if (!fs.existsSync(ERROR_LOG_FILE)) {
        console.log(`[Auto-Fix] ❌ build.log NOT FOUND at ${ERROR_LOG_FILE}`);
        return null;
    }
    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');
    console.log(`[Auto-Fix] Build log size: ${log.length} chars`);

    const lines = log.split('\n');
    const errorLines = lines.filter(l =>
        l.includes('[ERROR]') ||
        l.includes('error:') ||
        l.includes('cannot find symbol') ||
        l.includes('class, interface, enum') ||
        l.includes('.java:[') ||
        l.includes('COMPILATION ERROR')
    );

    console.log(`[Auto-Fix] Extracted ${errorLines.length} error lines.`);

    if (errorLines.length === 0) {
        console.log(`[Auto-Fix] No [ERROR] lines found. Showing last 50 lines of build.log:`);
        console.log(lines.slice(-50).join('\n'));
        return null;
    }

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
            // Skip target folder (Maven build output)
            if (file === 'target' || file === '.git') continue;
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walk(fullPath);
            } else {
                // Only include source files
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
// 3. AI CALLER (with proper timeout)
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

    for (const p of providers) {
        if (!p.key) continue;
        try {
            console.log(`[Auto-Fix] Trying ${p.name} (${p.model})...`);
            const headers = { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json', ...(p.extra || {}) };

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

            const res = await fetch(p.url, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model: p.model,
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.1,
                    max_tokens: 32000 // 🔧 HIGH TOKEN LIMIT FOR AUTO-FIX
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) { console.log(`[Auto-Fix] ${p.name} status ${res.status}`); continue; }
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text) { console.log(`[Auto-Fix] ${p.name} returned empty`); continue; }

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
            console.error(`[Auto-Fix] ${p.name} error:`, err.message);
        }
    }
    throw new Error('All AI providers failed for auto-fix');
}

// ═══════════════════════════════════════════
// 4. MAIN AUTO-FIX FLOW
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED ═══');

    const errorLog = getErrorLog();
    if (!errorLog) {
        console.log('[Auto-Fix] ❌ No usable error log. Exiting.');
        process.exit(1); // 🔧 FAIL LOUDLY so workflow stops
    }

    console.log(`[Auto-Fix] Error log preview:\n${errorLog.substring(0, 500)}...\n`);

    const projectFiles = getAllProjectFiles();
    console.log(`[Auto-Fix] Loaded ${projectFiles.length} project files:`);
    projectFiles.forEach(f => console.log(`  - ${f.path}`));

    if (projectFiles.length === 0) {
        console.log('[Auto-Fix] ❌ No project files found. Exiting.');
        process.exit(1);
    }

    const fullFileList = projectFiles.map(f => `<file: ${f.path}>\n${f.content}\n</file>`).join('\n\n');

    // 🔧 IMPROVED PROMPT: Specific Java error handling
    const repairPrompt = `You are an expert Java developer fixing a Minecraft Paper plugin that failed to compile in Maven.

BUILD ERROR LOG:
${errorLog}

ALL PROJECT FILES:
${fullFileList}

CRITICAL FIXING INSTRUCTIONS:
1. Read the error log carefully. Each line shows: FILE_PATH:[LINE,COL] ERROR_MESSAGE
2. Common Java compilation errors and how to fix:
   - "cannot find symbol" → Add missing import at the top of the file, OR create the missing class if it doesn't exist.
   - "class, interface, enum, or record expected" → The file has EXTRA content after the main class closing brace. Find the LAST closing brace of the main class and DELETE everything after it.
   - "package X does not exist" → Check the import path and package declaration.
   - "incompatible types" → Fix variable assignments.
   - "method X cannot be applied to given types" → Fix method calls with correct arguments.
   - "variable X might not have been initialized" → Initialize the variable.
   - "unreachable statement" → Remove dead code.
3. Fix ONLY the reported errors. Do NOT refactor unrelated code.
4. CRITICAL: Return EVERY SINGLE FILE in the project, even unchanged files. The entire project must be returned so we can rebuild.
5. Return files in this EXACT format (no markdown, no explanation):

<file: path/to/file>
content
</file>

Paper API 1.21.1, Java 21, Package: com.flickzz.generated`;

    try {
        const fixedFiles = await callBestAIModel(repairPrompt);
        console.log(`[Auto-Fix] Writing ${fixedFiles.length} fixed files to disk...`);

        for (const file of fixedFiles) {
            const fullPath = path.join(PROJECT_DIR, file.path);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, file.content, 'utf-8');
            console.log(`  ✍️  Wrote ${file.path}`);
        }

        console.log('[Auto-Fix] ✅ All files written. Maven will now retry.');
    } catch (err) {
        console.error('[Auto-Fix] ❌ FATAL:', err.message);
        process.exit(1);
    }
}

main();
