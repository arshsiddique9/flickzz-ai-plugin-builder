// ============================================
// FlickZZ Auto-Fixer v7 — Context-Aware Chunked
// - Knows what user is building
// - Knows what each file does
// - Smart size validation (no rigid 70% rule)
// - Massive provider list with new free gateways
// ============================================

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════
// API KEYS (existing)
// ═══════════════════════════════════════════
const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY;
const TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY; // 🆕 Add this
const KILO_API_KEY = process.env.KILO_API_KEY; // 🆕 Add this

const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');
const CONTEXT_FILE = path.join(PROJECT_DIR, 'project-context.json');

// ═══════════════════════════════════════════
// 1. LOAD PROJECT CONTEXT
// ═══════════════════════════════════════════
function loadProjectContext() {
    if (!fs.existsSync(CONTEXT_FILE)) {
        console.log('[Auto-Fix] No context file — using minimal mode');
        return { userPrompt: 'Unknown', files: [], packageStructure: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8'));
    } catch (e) {
        console.log('[Auto-Fix] Context file corrupt, using minimal mode');
        return { userPrompt: 'Unknown', files: [], packageStructure: {} };
    }
}

// ═══════════════════════════════════════════
// 2. ANALYZE ERRORS
// ═══════════════════════════════════════════
function analyzeErrors() {
    if (!fs.existsSync(ERROR_LOG_FILE)) return null;
    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');

    const errorLines = log.split('\n').filter(l =>
        l.includes('[ERROR]') &&
        (l.includes('.java:[') || l.includes('cannot find symbol') ||
         l.includes('reached end of file') || l.includes('class, interface') ||
         l.includes("';' expected") || l.includes('cannot be applied') ||
         l.includes('incompatible types') || l.includes('does not exist'))
    );

    const errorsByFile = {};
    const filePathRegex = /([^\s:]+\.java):\[(\d+),(\d+)\]\s*(.*)$/;

    for (const line of errorLines) {
        const match = line.match(filePathRegex);
        if (!match) continue;
        const relMatch = match[1].match(/com\/flickzz\/generated\/.*\.java$/);
        if (!relMatch) continue;
        const relPath = 'src/main/java/' + relMatch[0];
        if (!errorsByFile[relPath]) errorsByFile[relPath] = [];
        errorsByFile[relPath].push({ line: match[2], col: match[3], message: match[4] });
    }
    return errorsByFile;
}

// ═══════════════════════════════════════════
// 3. BUILD RICH CONTEXT FOR AI
// ═══════════════════════════════════════════
function buildAIContext(projectContext) {
    const lines = [];

    lines.push(`═══ USER'S ORIGINAL REQUEST ═══`);
    lines.push(projectContext.userPrompt || 'Not available');
    lines.push('');

    lines.push(`═══ PROJECT STRUCTURE ═══`);
    lines.push(`Plugin: ${projectContext.pluginName}`);
    lines.push(`Total files: ${projectContext.files.length}`);
    lines.push('');

    lines.push(`═══ FILE PURPOSES ═══`);
    for (const f of projectContext.files) {
        lines.push(`- ${f.path}`);
        if (f.className) lines.push(`  Class: ${f.className} (${f.type})`);
        if (f.package) lines.push(`  Package: ${f.package}`);
        if (f.publicMethods && f.publicMethods.length > 0) {
            lines.push(`  Public methods: ${f.publicMethods.slice(0, 8).join(', ')}`);
        }
        lines.push('');
    }

    lines.push(`═══ PACKAGE STRUCTURE ═══`);
    for (const [pkg, files] of Object.entries(projectContext.packageStructure || {})) {
        lines.push(`${pkg}:`);
        files.forEach(f => lines.push(`  - ${f}`));
    }

    return lines.join('\n');
}

// ═══════════════════════════════════════════
// 4. PROVIDER LIST — EXPANDED
// ═══════════════════════════════════════════
function getProviders() {
    return [
        // Dahl (existing, working)
        { name: 'Dahl-MiniMax', url: 'https://inference.dahl.global/v1/chat/completions',
          key: DAHL_API_KEY, model: 'MiniMaxAI/MiniMax-M2.7', timeout: 120000 },
        { name: 'Dahl-DeepSeek', url: 'https://inference.dahl.global/v1/chat/completions',
          key: DAHL_API_KEY, model: 'deepseek-ai/DeepSeek-V4-Flash-0731', timeout: 120000 },
        // Nara (existing, working)
        { name: 'Nara-Super', url: 'https://router.bynara.id/v1/chat/completions',
          key: NARA_API_KEY, model: 'nemotron-3-super-free', timeout: 120000 },
        { name: 'Nara-Ultra', url: 'https://router.bynara.id/v1/chat/completions',
          key: NARA_API_KEY, model: 'nemotron-3-ultra-free', timeout: 120000 },
        { name: 'Nara-Laguna', url: 'https://router.bynara.id/v1/chat/completions',
          key: NARA_API_KEY, model: 'laguna-s-2.1', timeout: 120000 },
        // OpenRouter (existing)
        { name: 'OpenRouter-Qwen', url: 'https://openrouter.ai/api/v1/chat/completions',
          key: OPENROUTER_API_KEY, model: 'qwen/qwen3-coder:free',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 120000 },
        { name: 'OpenRouter-Nemotron', url: 'https://openrouter.ai/api/v1/chat/completions',
          key: OPENROUTER_API_KEY, model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 120000 },
        { name: 'OpenRouter-DeepSeek', url: 'https://openrouter.ai/api/v1/chat/completions',
          key: OPENROUTER_API_KEY, model: 'deepseek/deepseek-v4-flash:free',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 120000 },
        // AgentRouter (existing)
        { name: 'AgentRouter-Claude', url: 'https://agentrouter.org/v1/chat/completions',
          key: AGENTROUTER_API_KEY, model: 'claude-opus-4-8',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 120000 },
        { name: 'AgentRouter-GPT6', url: 'https://agentrouter.org/v1/chat/completions',
          key: AGENTROUTER_API_KEY, model: 'gpt-6-astra',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 120000 },
        // UNOROUTER (existing)
        { name: 'UNOROUTER-Nemotron', url: 'https://api.unorouter.com/v1/chat/completions',
          key: UNOROUTER_API_KEY, model: 'nemotron-3-ultra-550b-a55b:free', timeout: 120000 },
        // 🆕 NVIDIA NIM — 180+ free models
        { name: 'NVIDIA-Qwen-Coder', url: 'https://integrate.api.nvidia.com/v1/chat/completions',
          key: NVIDIA_API_KEY, model: 'qwen/qwen2.5-coder-32b-instruct', timeout: 120000 },
        { name: 'NVIDIA-DeepSeek', url: 'https://integrate.api.nvidia.com/v1/chat/completions',
          key: NVIDIA_API_KEY, model: 'deepseek-ai/deepseek-r1', timeout: 120000 },
        { name: 'NVIDIA-Llama', url: 'https://integrate.api.nvidia.com/v1/chat/completions',
          key: NVIDIA_API_KEY, model: 'meta/llama-4-maverick-17b-128e-instruct', timeout: 120000 },
        // 🆕 Kilo Gateway — keyless free models
        { name: 'Kilo-Auto', url: 'https://api.kilo.ai/api/gateway/chat/completions',
          key: KILO_API_KEY || 'keyless', model: 'kilo-auto/free', timeout: 120000 },
        // 🆕 Keyless free providers (no API key needed)
        { name: 'Pollinations', url: 'https://text.pollinations.ai/openai',
          key: 'keyless', model: 'gpt-oss-20b', timeout: 90000 },
    ];
}

// ═══════════════════════════════════════════
// 5. SMART SIZE CHECK (not rigid 70%)
// ═══════════════════════════════════════════
function isSizeAcceptable(originalContent, fixedContent, filePath) {
    const origLen = originalContent.length;
    const newLen = fixedContent.length;

    // If file was very small, any reasonable response is fine
    if (origLen < 500) return newLen > 100;

    // For bigger files: check that we didn't lose critical structure
    const origClasses = (originalContent.match(/class\s+\w+/g) || []).length;
    const newClasses = (fixedContent.match(/class\s+\w+/g) || []).length;
    const origMethods = (originalContent.match(/public\s+[\w<>\[\]]+\s+\w+\s*\(/g) || []).length;
    const newMethods = (fixedContent.match(/public\s+[\w<>\[\]]+\s+\w+\s*\(/g) || []).length;

    // If we lost classes or >30% methods, reject
    if (newClasses < origClasses) {
        console.log(`  ⚠️  Lost classes (${origClasses} → ${newClasses})`);
        return false;
    }
    if (origMethods > 0 && newMethods < origMethods * 0.7) {
        console.log(`  ⚠️  Lost methods (${origMethods} → ${newMethods})`);
        return false;
    }

    // If response is less than 50% of original AND original was > 1000 chars, reject
    if (origLen > 1000 && newLen < origLen * 0.5) {
        console.log(`  ⚠️  Response too small (${origLen} → ${newLen})`);
        return false;
    }

    return true;
}

// ═══════════════════════════════════════════
// 6. FIX SINGLE FILE (chunked with context)
// ═══════════════════════════════════════════
async function fixSingleFile(filePath, fileContent, fileErrors, projectContext, aiContext) {
    const errorText = fileErrors.map(e => `Line ${e.line}:${e.col} — ${e.message}`).join('\n');

    const prompt = `You are fixing ONE specific file in a Minecraft Paper plugin project.

═══════════════════════════════════════════
USER'S ORIGINAL REQUEST (what they're building)
═══════════════════════════════════════════
${projectContext.userPrompt}

═══════════════════════════════════════════
PROJECT CONTEXT
═══════════════════════════════════════════
${aiContext}

═══════════════════════════════════════════
FILE TO FIX: ${filePath}
ORIGINAL SIZE: ${fileContent.length} chars
═══════════════════════════════════════════

CURRENT CONTENT:
${fileContent}

═══════════════════════════════════════════
ERRORS IN THIS FILE
═══════════════════════════════════════════
${errorText}

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════
1. PRESERVE ALL EXISTING CODE — Do NOT delete any method, class, or logic that isn't causing the error.
2. DO NOT change package names or class names.
3. If error is "cannot find symbol X" → Add import for X based on PROJECT CONTEXT above.
4. If error is "package X does not exist" → Check PROJECT CONTEXT for correct package name.
5. If error is "reached end of file while parsing" → Add missing closing brace(s) }.
6. If error is "class, interface, enum, or record expected" → Remove ONLY the extra content AFTER the final class closing brace.
7. The response must include the COMPLETE file content (all original code + fixes).

Return ONLY in this format — NOTHING ELSE:
<file: ${filePath}>
[complete fixed file content]
</file>`;

    const providers = getProviders();
    let attempted = 0;

    for (let round = 0; round < 2; round++) {
        for (const p of providers) {
            if (!p.key) continue;
            attempted++;
            try {
                console.log(`[Auto-Fix]   Trying ${p.name} (${p.model})${round > 0 ? ` [round ${round+1}]` : ''}...`);

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), p.timeout || 120000);

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
                            { role: 'system', content: 'You are a Java code fixer. Return ONLY the file in <file: path>content</file> format. Preserve ALL original code.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: round === 0 ? 0.05 : 0.2,
                        max_tokens: 12000
                    })
                });
                clearTimeout(timeoutId);

                if (!res.ok) { console.log(`[Auto-Fix]   ${p.name} HTTP ${res.status}`); continue; }

                const ct = res.headers.get('content-type') || '';
                if (!ct.includes('application/json')) { console.log(`[Auto-Fix]   ${p.name} non-JSON`); continue; }

                const data = await res.json();
                const text = data.choices?.[0]?.message?.content || '';
                if (!text || text.length < 30) { console.log(`[Auto-Fix]   ${p.name} empty`); continue; }

                const parts = text.split(/<file:\s*/);
                parts.shift();

                for (const part of parts) {
                    const lines = part.split('\n');
                    let content = lines.slice(1).join('\n').trim();
                    content = content.replace(/<\/file>\s*$/, '').trim();
                    if (content.length < 30) continue;

                    if (!isSizeAcceptable(fileContent, content, filePath)) {
                        console.log(`[Auto-Fix]   ${p.name} rejected by size check`);
                        continue;
                    }

                    console.log(`[Auto-Fix]   ✅ ${p.name} fixed (${content.length} chars)`);
                    return content;
                }
                console.log(`[Auto-Fix]   ${p.name} parse failed`);
            } catch (err) {
                console.log(`[Auto-Fix]   ${p.name} error: ${err.message}`);
            }
        }
    }
    return null;
}

// ═══════════════════════════════════════════
// 7. MAIN
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED (v7 — Context-Aware) ═══');

    const projectContext = loadProjectContext();
    const aiContext = buildAIContext(projectContext);

    console.log(`[Auto-Fix] User prompt: ${(projectContext.userPrompt || '').substring(0, 80)}...`);
    console.log(`[Auto-Fix] Project files: ${projectContext.files.length}`);

    const errorsByFile = analyzeErrors();
    if (!errorsByFile) { console.log('[Auto-Fix] ❌ No errors.'); process.exit(1); }

    const brokenFiles = Object.keys(errorsByFile);
    console.log(`[Auto-Fix] Broken files: ${brokenFiles.length}`);
    brokenFiles.forEach(f => console.log(`  - ${f} (${errorsByFile[f].length} errors)`));

    let fixed = 0, failed = 0;

    for (const filePath of brokenFiles) {
        console.log(`\n[Auto-Fix] ═══ Fixing: ${filePath} ═══`);
        const fullPath = path.join(PROJECT_DIR, filePath);
        if (!fs.existsSync(fullPath)) { failed++; continue; }

        const content = fs.readFileSync(fullPath, 'utf-8');
        console.log(`[Auto-Fix] Original: ${content.length} chars`);

        const fixedContent = await fixSingleFile(filePath, content, errorsByFile[filePath], projectContext, aiContext);

        if (fixedContent) {
            fs.writeFileSync(fullPath, fixedContent, 'utf-8');
            console.log(`[Auto-Fix] 💾 Saved (${fixedContent.length} chars)`);
            fixed++;
        } else {
            console.log(`[Auto-Fix] ❌ Could not fix`);
            failed++;
        }
    }

    console.log(`\n[Auto-Fix] ═══ SUMMARY ═══`);
    console.log(`[Auto-Fix] Fixed: ${fixed}/${brokenFiles.length}`);
    console.log(`[Auto-Fix] Failed: ${failed}/${brokenFiles.length}`);
    if (fixed === 0) process.exit(1);
}

main().catch(err => { console.error('[Auto-Fix] Fatal:', err); process.exit(1); });
