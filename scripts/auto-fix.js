// ============================================
// FlickZZ Auto-Fixer Script (v3 - Fixed)
// Runs on GitHub Actions
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
        l.includes('.java:[') ||
        l.includes('COMPILATION ERROR')
    );

    console.log(`[Auto-Fix] Extracted ${errorLines.length} error lines.`);

    if (errorLines.length === 0) {
        console.log('[Auto-Fix] Last 30 lines of build log for debugging:');
        console.log(lines.slice(-30).join('\n'));
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
        for (const file of fs.readdirSync(dir)) {
            if (file === 'target' || file === '.git' || file === 'build.log') continue;
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walk(fullPath);
            } else if (fullPath.match(/\.(java|xml|yml|yaml|json|properties)$/)) {
                const relativePath = path.relative(PROJECT_DIR, fullPath).replace(/\\/g, '/');
                files.push({
                    path: relativePath,
                    content: fs.readFileSync(fullPath, 'utf-8')
                });
            }
        }
    }
    walk(PROJECT_DIR);
    return files;
}

// ═══════════════════════════════════════════
// 3. AI CALLER
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
    let bestCandidate = null;

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
                headers: {
                    'Authorization': `Bearer ${p.key}`,
                    'Content-Type': 'application/json',
                    ...(p.extra || {})
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: p.model,
                    messages: [
                        { role: 'system', content: 'You are a Java code fixer. Output ONLY files in <file: path>content</file> format. No markdown. No explanation.' },
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
                console.log(`[Auto-Fix] ${p.name} returned empty`);
                continue;
            }

            console.log(`[Auto-Fix] ${p.name} returned ${text.length} chars`);
            console.log(`[Auto-Fix] Preview: ${text.substring(0, 200).replace(/\n/g, ' ⏎ ')}...`);

            const files = parseFilesFromAI(text);
            if (files.length > 0) {
                console.log(`[Auto-Fix] ✅ ${p.name} returned ${files.length} files`);
                return files;
            }
            console.log(`[Auto-Fix] ${p.name} parsed 0 files`);
        } catch (err) {
            console.error(`[Auto-Fix] ${p.name} error:`, err.message);
        }
    }

    throw new Error(`All ${attempted} providers failed`);
}

// ═══════════════════════════════════════════
// 4. PARSE FILES
// ═══════════════════════════════════════════
function parseFilesFromAI(text) {
    const files = [];
    const parts = text.split(/<file:\s*/);
    parts.shift();

    for (const part of parts) {
        const lines = part.split('\n');
        let filePath = lines[0].replace(/>.*$/, '').trim();
        let content = lines.slice(1).join('\n').trim();
        content = content.replace(/<\/file>\s*$/, '').trim();
        if (filePath && content) {
            files.push({ path: filePath, content });
        }
    }

    if (files.length === 0) {
        // Fallback: markdown code blocks
        const regex = /```(?:java|xml|yaml|yml|json)?\s*\n\s*(?:\/\/|#)\s*([\w\-\.\/]+)\s*\n([\s\S]*?)```/gi;
        let m;
        while ((m = regex.exec(text)) !== null) {
            files.push({ path: m[1].trim(), content: m[2].trim() });
        }
    }
    return files;
}

// ═══════════════════════════════════════════
// 5. MAIN — All await calls go inside here
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED ═══');

    // Debug: API keys check
    console.log('[Auto-Fix] API Key availability:');
    console.log(`  DAHL_API_KEY: ${DAHL_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`  NARA_API_KEY: ${NARA_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`  OPENROUTER_API_KEY: ${OPENROUTER_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`  AGENTROUTER_API_KEY: ${AGENTROUTER_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`  UNOROUTER_API_KEY: ${UNOROUTER_API_KEY ? 'SET' : 'MISSING'}`);
    console.log(`  TOKENHARBOR_API_KEY: ${TOKENHARBOR_API_KEY ? 'SET' : 'MISSING'}`);

    const errorLog = getErrorLog();
    if (!errorLog) {
        console.log('[Auto-Fix] ❌ No usable error log. Exiting.');
        process.exit(1);
    }

    console.log(`[Auto-Fix] Error log preview:\n${errorLog.substring(0, 500)}\n`);

    const originalFiles = getAllProjectFiles();
    console.log(`[Auto-Fix] Loaded ${originalFiles.length} project files:`);
    originalFiles.forEach(f => console.log(`  - ${f.path}`));

    if (originalFiles.length === 0) {
        console.log('[Auto-Fix] ❌ No project files found.');
        process.exit(1);
    }

    const fullFileList = originalFiles.map(f => `<file: ${f.path}>\n${f.content}\n</file>`).join('\n\n');

    const repairPrompt = `You are an expert Java developer fixing a Minecraft Paper plugin that failed to compile.

BUILD ERROR LOG:
${errorLog}

ALL PROJECT FILES:
${fullFileList}

CRITICAL FIXING INSTRUCTIONS:
1. Read the error log carefully. Each line shows: FILE_PATH:[LINE,COL] ERROR_MESSAGE
2. Common Java compilation errors and fixes:
   - "reached end of file while parsing" → MISSING closing brace } at end of file. Add closing braces.
   - "class, interface, enum, or record expected" → EXTRA content after class closing brace. Delete everything after last } of the main class.
   - "';' expected" → Missing semicolon. Add it.
   - "cannot find symbol" → Add missing import at top of file OR create the missing class.
   - "package does not exist" → Fix import path.
   - "incompatible types" → Fix variable assignments.
   - "variable might not have been initialized" → Initialize it.
3. Fix ONLY the reported errors. Do NOT refactor unrelated code.
4. Return EVERY SINGLE FILE in the project, even unchanged ones.

OUTPUT FORMAT — MANDATORY:
Output ONLY files in this exact format. NOTHING else.
NO explanations. NO markdown. NO \`\`\`.

<file: path/to/file>
content
</file>

Paper API 1.21.1, Java 21, Package: com.flickzz.generated

NOW OUTPUT ALL ${originalFiles.length} FILES. START NOW.`;

    try {
        const fixedFiles = await callBestAIModel(repairPrompt);

        console.log(`[Auto-Fix] Received ${fixedFiles.length} fixed files from AI.`);
        console.log(`[Auto-Fix] Writing files...`);

        const originalPaths = new Set(originalFiles.map(f => f.path));
        let updatedCount = 0;
        let newCount = 0;

        for (const file of fixedFiles) {
            const fullPath = path.join(PROJECT_DIR, file.path);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

            const existed = originalPaths.has(file.path);
            fs.writeFileSync(fullPath, file.content, 'utf-8');

            if (existed) {
                updatedCount++;
                console.log(`  ✍️  Updated: ${file.path}`);
            } else {
                newCount++;
                console.log(`  ✨ Created: ${file.path}`);
            }
        }

        console.log(`[Auto-Fix] ✅ Summary:`);
        console.log(`     - ${updatedCount} files updated`);
        console.log(`     - ${newCount} new files created`);
        console.log(`     - ${originalFiles.length - updatedCount} files kept original`);
    } catch (err) {
        console.error('[Auto-Fix] ❌ FATAL:', err.message);
        process.exit(1);
    }
}

// ═══════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════
main().catch(err => {
    console.error('[Auto-Fix] Unhandled error:', err);
    process.exit(1);
});
