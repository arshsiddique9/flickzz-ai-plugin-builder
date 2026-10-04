// ============================================
// FlickZZ Auto-Fixer v8 — Smart Brace Fix + Context
// ============================================

const fs = require('fs');
const path = require('path');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY;

const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');
const CONTEXT_FILE = path.join(PROJECT_DIR, 'project-context.json');

// ═══════════════════════════════════════════
// 🆕 DETERMINISTIC BRACE FIX (No AI needed!)
// Fixes "reached end of file while parsing" 100%
// ═══════════════════════════════════════════
function fixBraces(content) {
    // Remove strings and comments to count braces accurately
    let clean = content
        .replace(/\/\/[^\n]*/g, '')           // remove // comments
        .replace(/\/\*[\s\S]*?\*\//g, '')     // remove /* */ comments
        .replace(/"(?:\\.|[^"\\])*"/g, '""')  // remove string literals
        .replace(/'(?:\\.|[^'\\])*'/g, "''"); // remove char literals

    const openBraces = (clean.match(/\{/g) || []).length;
    const closeBraces = (clean.match(/\}/g) || []).length;
    const diff = openBraces - closeBraces;

    if (diff === 0) {
        return { content, fixed: false, info: 'Braces balanced' };
    }

    if (diff > 0) {
        // Need to add closing braces
        const extra = '\n' + '}'.repeat(diff);
        return {
            content: content.trimEnd() + extra + '\n',
            fixed: true,
            info: `Added ${diff} missing closing brace(s)`
        };
    }

    // diff < 0: too many closing braces — remove extras from end
    // Find position of the last legitimate closing brace
    let newContent = content;
    let removed = 0;
    for (let i = 0; i < -diff; i++) {
        const lastBrace = newContent.lastIndexOf('}');
        if (lastBrace === -1) break;
        newContent = newContent.substring(0, lastBrace) + newContent.substring(lastBrace + 1);
        removed++;
    }
    return {
        content: newContent,
        fixed: true,
        info: `Removed ${removed} extra closing brace(s)`
    };
}

// ═══════════════════════════════════════════
// CONTEXT LOADING
// ═══════════════════════════════════════════
function loadProjectContext() {
    if (!fs.existsSync(CONTEXT_FILE)) return { userPrompt: 'Unknown', files: [], packageStructure: {} };
    try { return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8')); }
    catch (e) { return { userPrompt: 'Unknown', files: [], packageStructure: {} }; }
}

function buildAIContext(projectContext) {
    const lines = [];
    lines.push(`USER REQUEST: ${projectContext.userPrompt || 'Not available'}`);
    lines.push('');
    lines.push(`PROJECT FILES (${projectContext.files.length} total):`);
    for (const f of projectContext.files) {
        if (f.path.endsWith('.java')) {
            lines.push(`- ${f.path}`);
            if (f.className) lines.push(`  Class: ${f.className} | Package: ${f.package}`);
            if (f.publicMethods && f.publicMethods.length > 0) {
                lines.push(`  Methods: ${f.publicMethods.slice(0, 6).join(', ')}`);
            }
        }
    }
    return lines.join('\n');
}

// ═══════════════════════════════════════════
// ERROR ANALYSIS
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
// AI CALLER — PER FILE
// ═══════════════════════════════════════════
async function callAI(filePath, fileContent, fileErrors, aiContext) {
    const errorText = fileErrors.map(e => `Line ${e.line}:${e.col} — ${e.message}`).join('\n');

    const prompt = `Fix Java compilation errors in ONE file. Preserve ALL original code.

CONTEXT:
${aiContext}

FILE: ${filePath}
ORIGINAL LENGTH: ${fileContent.length} chars

CURRENT CONTENT:
${fileContent}

ERRORS:
${errorText}

RULES:
1. "reached end of file" → Missing closing brace }. Add it.
2. "class, interface, enum expected" → Extra content after class. Remove it.
3. "cannot find symbol" → Add missing import based on CONTEXT above.
4. "package X does not exist" → Fix import path based on CONTEXT.
5. DO NOT change package names or class names.
6. Return ONLY the complete file (all original code + fixes).

Return ONLY:
<file: ${filePath}>
[complete fixed content]
</file>`;

    const providers = [
        { name: 'Dahl-MiniMax', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'MiniMaxAI/MiniMax-M2.7', timeout: 90000 },
        { name: 'Nara-Super', url: 'https://router.bynara.id/v1/chat/completions', key: NARA_API_KEY, model: 'nemotron-3-super-free', timeout: 90000 },
        { name: 'Nara-Ultra', url: 'https://router.bynara.id/v1/chat/completions', key: NARA_API_KEY, model: 'nemotron-3-ultra-free', timeout: 90000 },
        { name: 'Dahl-DeepSeek', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'deepseek-ai/DeepSeek-V4-Flash-0731', timeout: 90000 },
        { name: 'OpenRouter-Qwen', url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_API_KEY, model: 'qwen/qwen3-coder:free',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 90000 },
        { name: 'AgentRouter', url: 'https://agentrouter.org/v1/chat/completions', key: AGENTROUTER_API_KEY, model: 'claude-opus-4-8',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' }, timeout: 90000 },
    ];

    for (const p of providers) {
        if (!p.key) continue;
        try {
            console.log(`[Auto-Fix]   Trying ${p.name}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), p.timeout);

            const res = await fetch(p.url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${p.key}`, 'Content-Type': 'application/json', ...(p.extra || {}) },
                signal: controller.signal,
                body: JSON.stringify({
                    model: p.model,
                    messages: [
                        { role: 'system', content: 'You are a Java code fixer. Return ONLY the file in <file: path>content</file> format. Preserve ALL original code.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.05,
                    max_tokens: 12000
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) { console.log(`[Auto-Fix]   ${p.name} HTTP ${res.status}`); continue; }
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) continue;

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text) continue;

            const parts = text.split(/<file:\s*/);
            parts.shift();
            for (const part of parts) {
                const lines = part.split('\n');
                let content = lines.slice(1).join('\n').trim();
                content = content.replace(/<\/file>\s*$/, '').trim();
                if (content.length < 30) continue;

                // Reject if response lost too much
                if (content.length < fileContent.length * 0.5 && fileContent.length > 1000) {
                    console.log(`[Auto-Fix]   ${p.name} response too small (${content.length} vs ${fileContent.length})`);
                    continue;
                }

                console.log(`[Auto-Fix]   ✅ ${p.name} (${content.length} chars)`);
                return content;
            }
        } catch (err) {
            console.log(`[Auto-Fix]   ${p.name} error: ${err.message}`);
        }
    }
    return null;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED (v8) ═══');

    const projectContext = loadProjectContext();
    const aiContext = buildAIContext(projectContext);
    console.log(`[Auto-Fix] Context: ${projectContext.files.length} files, prompt: ${(projectContext.userPrompt || '').substring(0, 50)}`);

    const errorsByFile = analyzeErrors();
    if (!errorsByFile) { console.log('[Auto-Fix] No errors.'); process.exit(1); }

    const brokenFiles = Object.keys(errorsByFile);
    console.log(`[Auto-Fix] Broken files: ${brokenFiles.length}`);

    let fixed = 0, failed = 0;

    for (const filePath of brokenFiles) {
        console.log(`\n[Auto-Fix] ═══ ${filePath} ═══`);
        const fullPath = path.join(PROJECT_DIR, filePath);
        if (!fs.existsSync(fullPath)) { failed++; continue; }

        let content = fs.readFileSync(fullPath, 'utf-8');
        const originalLen = content.length;
        console.log(`[Auto-Fix] Original: ${originalLen} chars`);

        // 🆕 STEP 1: Try deterministic brace fix first
        const braceResult = fixBraces(content);
        if (braceResult.fixed) {
            console.log(`[Auto-Fix] 🔧 Brace fix: ${braceResult.info}`);
            content = braceResult.content;
        }

        // Check if errors are now resolved by brace fix
        const braceOnlyErrors = errorsByFile[filePath].every(e =>
            e.message.includes('reached end of file') ||
            e.message.includes('class, interface')
        );

        if (braceOnlyErrors && braceResult.fixed) {
            fs.writeFileSync(fullPath, content, 'utf-8');
            console.log(`[Auto-Fix] ✅ Fixed by brace-balance (no AI needed) → ${content.length} chars`);
            fixed++;
            continue;
        }

        // 🆕 STEP 2: If brace fix insufficient, use AI
        console.log(`[Auto-Fix] Sending to AI...`);
        const fixedContent = await callAI(filePath, content, errorsByFile[filePath], aiContext);

        if (fixedContent) {
            // 🆕 STEP 3: Re-check braces after AI
            const recheck = fixBraces(fixedContent);
            const finalContent = recheck.fixed ? recheck.content : fixedContent;
            if (recheck.fixed) console.log(`[Auto-Fix]   🔧 Post-AI brace fix: ${recheck.info}`);

            fs.writeFileSync(fullPath, finalContent, 'utf-8');
            console.log(`[Auto-Fix] 💾 Saved (${finalContent.length} chars)`);
            fixed++;
        } else {
            console.log(`[Auto-Fix] ❌ Could not fix`);
            failed++;
        }
    }

    console.log(`\n[Auto-Fix] SUMMARY: Fixed ${fixed}/${brokenFiles.length}, Failed ${failed}/${brokenFiles.length}`);
    if (fixed === 0) process.exit(1);
}

main().catch(err => { console.error('[Auto-Fix] Fatal:', err); process.exit(1); });
