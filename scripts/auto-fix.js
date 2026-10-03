// ============================================
// FlickZZ Auto-Fixer Script (Runs on GitHub Actions)
// ============================================

const fs = require('fs');
const path = require('path');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY;
const TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY;

const PROJECT_DIR = './plugin-src';
const ERROR_LOG_FILE = './plugin-src/build.log';
const MAX_FIX_ATTEMPTS = 3;

// ═══════════════════════════════════════════
// 1. READ ERROR LOG
// ═══════════════════════════════════════════
function getErrorLog() {
    if (!fs.existsSync(ERROR_LOG_FILE)) return 'No build log found';
    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');
    const lines = log.split('\n');
    const errorLines = lines.filter(l => l.includes('[ERROR]') || l.includes('error:'));
    return errorLines.slice(0, 50).join('\n');
}

// ═══════════════════════════════════════════
// 2. READ ALL PROJECT FILES
// ═══════════════════════════════════════════
function getAllProjectFiles() {
    const files = [];
    function walk(dir) {
        const list = fs.readdirSync(dir);
        for (const file of list) {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);
            if (stat.isDirectory()) {
                walk(fullPath);
            } else {
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
// 3. AI CALLER (Same as generate.js)
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
            const res = await fetch(p.url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ model: p.model, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 16000 })
            });
            if (!res.ok) { console.log(`[Auto-Fix] ${p.name} failed with status ${res.status}`); continue; }
            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text) continue;

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
                console.log(`[Auto-Fix] ${p.name} returned ${files.length} fixed files!`);
                return files;
            }
        } catch (err) { console.error(`[Auto-Fix] ${p.name} error:`, err.message); }
    }
    throw new Error('All AI providers failed for auto-fix');
}

// ═══════════════════════════════════════════
// 4. MAIN AUTO-FIX FLOW
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED ═══');

    const errorLog = getErrorLog();
    console.log(`[Auto-Fix] Extracted ${errorLog.length} chars of error logs.`);

    if (!errorLog || errorLog === 'No build log found') {
        console.log('[Auto-Fix] No errors found in log. Exiting.');
        return;
    }

    const projectFiles = getAllProjectFiles();
    console.log(`[Auto-Fix] Loaded ${projectFiles.length} project files.`);

    const fullFileList = projectFiles.map(f => `<file: ${f.path}>\n${f.content}\n</file>`).join('\n\n');

    const repairPrompt = `A Minecraft Paper plugin failed to compile in Maven. You are an expert Java developer.
Your job is to fix the compilation errors and return the ENTIRE project structure with ALL files.

BUILD ERROR LOG:
${errorLog}

ALL PROJECT FILES:
${fullFileList}

CRITICAL INSTRUCTIONS FOR JAVA:
1. Analyze the error log and the provided files.
2. Common errors include missing imports. ALWAYS CHECK FOR THESE IMPORTS IF THE CLASS IS USED:
   - org.bukkit.Location
   - org.bukkit.entity.Player
   - org.bukkit.World
   - org.bukkit.Material
   - org.bukkit.inventory.ItemStack
   - org.bukkit.configuration.file.FileConfiguration
   - java.util.* (List, Map, etc.)
3. Fix the compilation errors.
4. DO NOT just fix the broken file. You must return EVERY SINGLE FILE in the project, exactly as it should be after the fix.
5. Return ALL files in this exact format:
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
        }

        console.log('[Auto-Fix] Successfully overwritten all project files.');
        console.log('[Auto-Fix] Maven will now try to rebuild.');
    } catch (err) {
        console.error('[Auto-Fix] FATAL: Could not fix the project.');
        console.error(err.message);
        process.exit(1);
    }
}

main();
