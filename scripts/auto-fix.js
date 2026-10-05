// ============================================
// FlickZZ Auto-Fixer v9 — Production
// Uses providers.js + token-tracker.js + context
// Deterministic fixes first, AI fallback only when needed
// ============================================

const fs = require('fs');
const path = require('path');
const { getProviders, recordSuccess, recordFailure } = require('./providers.js');
const { trackCall, getSummary } = require('./token-tracker.js');

const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');
const CONTEXT_FILE = path.join(PROJECT_DIR, 'project-context.json');

// ═══════════════════════════════════════════
// DETERMINISTIC FIX 1: BRACE BALANCE
// ═══════════════════════════════════════════
function fixBraces(content) {
    // Remove strings/comments to count braces accurately
    let clean = content
        .replace(/\/\/[^\n]*/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/"(?:\\.|[^"\\])*"/g, '""')
        .replace(/'(?:\\.|[^'\\])*'/g, "''");

    const openBraces = (clean.match(/\{/g) || []).length;
    const closeBraces = (clean.match(/\}/g) || []).length;
    const diff = openBraces - closeBraces;

    if (diff === 0) return { content, fixed: false, info: 'Braces balanced' };

    if (diff > 0) {
        // Missing closing braces — add at end
        const extra = '\n' + '}'.repeat(diff);
        return {
            content: content.trimEnd() + extra + '\n',
            fixed: true,
            info: `Added ${diff} missing }`
        };
    }

    // Too many closing braces — remove extras from end
    let newContent = content;
    let removed = 0;
    for (let i = 0; i < -diff; i++) {
        const lastBrace = newContent.lastIndexOf('}');
        if (lastBrace === -1) break;
        newContent = newContent.substring(0, lastBrace) + newContent.substring(lastBrace + 1);
        removed++;
    }
    return { content: newContent, fixed: true, info: `Removed ${removed} extra }` };
}

// ═══════════════════════════════════════════
// DETERMINISTIC FIX 2: PACKAGE PATH
// Detects "managers" → "manager" style typos
// ═══════════════════════════════════════════
function fixPackagePaths(content, projectStructure) {
    let fixed = content;
    const fixes = [];

    // Collect all valid packages from project
    const validPackages = new Set();
    const validLastSegments = new Set();

    for (const filePath of projectStructure) {
        if (!filePath.endsWith('.java')) continue;
        const fullPath = path.join(PROJECT_DIR, filePath);
        if (!fs.existsSync(fullPath)) continue;
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        const pkgMatch = fileContent.match(/^package\s+([\w\.]+);/m);
        if (pkgMatch) {
            validPackages.add(pkgMatch[1]);
            validLastSegments.add(pkgMatch[1].split('.').pop());
        }
    }

    // Fix common pluralization mistakes: "managers" → "manager"
    for (const lastSeg of validLastSegments) {
        // If valid segment is singular (manager), check for broken plural (managers)
        if (!lastSeg.endsWith('s')) {
            const wrongLast = lastSeg + 's';
            // Find any import with wrong plural
            const wrongImports = fixed.match(new RegExp(`com\\.flickzz\\.generated\\.([\\w\\.]*)${wrongLast}\\b`, 'g'));
            if (wrongImports) {
                for (const wrongImport of wrongImports) {
                    const correctImport = wrongImport.replace(new RegExp(wrongLast + '$'), lastSeg);
                    fixed = fixed.split(wrongImport).join(correctImport);
                    fixes.push(`${wrongImport} → ${correctImport}`);
                }
            }
        }
    }

    return { content: fixed, fixed: fixes.length > 0, info: fixes.join('; ') };
}

// ═══════════════════════════════════════════
// CONTEXT LOADING
// ═══════════════════════════════════════════
function loadProjectContext() {
    if (!fs.existsSync(CONTEXT_FILE)) {
        return { userPrompt: 'Unknown', files: [], packageStructure: {} };
    }
    try {
        return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8'));
    } catch {
        return { userPrompt: 'Unknown', files: [], packageStructure: {} };
    }
}

function buildAIContext(ctx) {
    const lines = [];
    lines.push(`USER REQUEST: ${ctx.userPrompt || 'Not available'}`);
    lines.push('');
    lines.push(`PROJECT FILES (${ctx.files.length}):`);
    for (const f of ctx.files) {
        if (f.path.endsWith('.java')) {
            lines.push(`- ${f.path}`);
            if (f.className) lines.push(`  Class: ${f.className} | Package: ${f.package}`);
            if (f.publicMethods?.length > 0) {
                lines.push(`  Methods: ${f.publicMethods.slice(0, 6).join(', ')}`);
            }
        }
    }
    lines.push('');
    lines.push(`PACKAGES:`);
    for (const [pkg, files] of Object.entries(ctx.packageStructure || {})) {
        lines.push(`- ${pkg}`);
        files.forEach(fp => lines.push(`  → ${fp.split('/').pop()}`));
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
        errorsByFile[relPath].push({
            line: match[2],
            col: match[3],
            message: match[4]
        });
    }
    return errorsByFile;
}

// ═══════════════════════════════════════════
// AI CALL — uses providers.js
// ═══════════════════════════════════════════
async function callAI(filePath, fileContent, fileErrors, aiContext, preferredStrength = 'coding') {
    const errorText = fileErrors.map(e => `Line ${e.line}:${e.col} — ${e.message}`).join('\n');

    const prompt = `Fix Java compilation errors in ONE file. Preserve ALL original code.

PROJECT CONTEXT:
${aiContext}

FILE: ${filePath}
ORIGINAL LENGTH: ${fileContent.length} chars

CURRENT CONTENT:
${fileContent}

ERRORS:
${errorText}

RULES:
1. "reached end of file" → Missing closing brace }.
2. "class, interface, enum expected" → Extra content after class. Remove it.
3. "cannot find symbol" → Add missing import based on CONTEXT above.
4. "package X does not exist" → Fix import path based on CONTEXT.
5. DO NOT change package names or class names.
6. DO NOT delete any method or class.
7. Return COMPLETE file (all original code + fixes).

Return ONLY this format:
<file: ${filePath}>
[complete fixed content]
</file>`;

    const providers = getProviders({ strength: preferredStrength });

    if (providers.length === 0) {
        console.log(`[Auto-Fix] ⚠️  No providers available for strength: ${preferredStrength}`);
        return null;
    }

    for (const p of providers) {
        try {
            console.log(`[Auto-Fix]   Trying ${p.name} (${p.model}, tier ${p.tier})...`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), p.timeout || 90000);

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
                    temperature: 0.05,
                    max_tokens: 12000
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                console.log(`[Auto-Fix]   ${p.name} HTTP ${res.status}`);
                recordFailure(p.name);
                continue;
            }

            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) {
                console.log(`[Auto-Fix]   ${p.name} non-JSON`);
                recordFailure(p.name);
                continue;
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text || text.length < 30) {
                console.log(`[Auto-Fix]   ${p.name} empty/short`);
                recordFailure(p.name);
                continue;
            }

            // Track tokens
            const usage = data.usage || {};
            trackCall(p.name, p.model, usage.prompt_tokens || 0, usage.completion_tokens || 0);

            // Parse
            const parts = text.split(/<file:\s*/);
            parts.shift();

            for (const part of parts) {
                const lines = part.split('\n');
                let content = lines.slice(1).join('\n').trim();
                content = content.replace(/<\/file>\s*$/, '').trim();
                if (content.length < 30) continue;

                // Size validation
                if (fileContent.length > 1000 && content.length < fileContent.length * 0.5) {
                    console.log(`[Auto-Fix]   ${p.name} response too small (${content.length} vs ${fileContent.length})`);
                    recordFailure(p.name);
                    continue;
                }

                console.log(`[Auto-Fix]   ✅ ${p.name} (${content.length} chars)`);
                recordSuccess(p.name);
                return content;
            }

            console.log(`[Auto-Fix]   ${p.name} parse failed`);
            recordFailure(p.name);
        } catch (err) {
            console.log(`[Auto-Fix]   ${p.name} error: ${err.message}`);
            recordFailure(p.name);
        }
    }

    return null;
}

// ═══════════════════════════════════════════
// FIX ONE FILE
// ═══════════════════════════════════════════
async function fixFile(filePath, errors, ctx, aiContext, projectStructure) {
    const fullPath = path.join(PROJECT_DIR, filePath);
    if (!fs.existsSync(fullPath)) {
        console.log(`[Auto-Fix] ❌ File not found: ${filePath}`);
        return false;
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    const originalLen = content.length;

    console.log(`\n[Auto-Fix] ═══ ${filePath} (${originalLen} chars, ${errors.length} errors) ═══`);

    // STEP 1: Deterministic brace fix
    const braceResult = fixBraces(content);
    if (braceResult.fixed) {
        console.log(`[Auto-Fix] 🔧 Brace fix: ${braceResult.info}`);
        content = braceResult.content;
    }

    // STEP 2: Deterministic package fix
    const pkgResult = fixPackagePaths(content, projectStructure);
    if (pkgResult.fixed) {
        console.log(`[Auto-Fix] 🔧 Package fix: ${pkgResult.info}`);
        content = pkgResult.content;
    }

    // Check if all errors are deterministic-type
    const allDeterministic = errors.every(e =>
        e.message.includes('reached end of file') ||
        e.message.includes('class, interface') ||
        e.message.includes('does not exist')
    );

    if (allDeterministic && (braceResult.fixed || pkgResult.fixed)) {
        fs.writeFileSync(fullPath, content, 'utf-8');
        console.log(`[Auto-Fix] ✅ Fixed deterministically (no AI) → ${content.length} chars`);
        return true;
    }

    // STEP 3: AI fallback
    console.log(`[Auto-Fix] Sending to AI...`);
    const fixed = await callAI(filePath, content, errors, aiContext, 'coding');

    if (fixed) {
        // Post-AI brace check
        const recheck = fixBraces(fixed);
        const final = recheck.fixed ? recheck.content : fixed;
        if (recheck.fixed) console.log(`[Auto-Fix]   🔧 Post-AI brace fix: ${recheck.info}`);

        fs.writeFileSync(fullPath, final, 'utf-8');
        console.log(`[Auto-Fix] 💾 Saved (${final.length} chars)`);
        return true;
    }

    console.log(`[Auto-Fix] ❌ Could not fix ${filePath}`);
    return false;
}

// ═══════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED (v9) ═══');

    const ctx = loadProjectContext();
    const aiContext = buildAIContext(ctx);

    console.log(`[Auto-Fix] Context: ${ctx.files.length} files`);
    console.log(`[Auto-Fix] User prompt: ${(ctx.userPrompt || 'Unknown').substring(0, 60)}`);

    const errorsByFile = analyzeErrors();
    if (!errorsByFile || Object.keys(errorsByFile).length === 0) {
        console.log('[Auto-Fix] No errors found.');
        process.exit(1);
    }

    const brokenFiles = Object.keys(errorsByFile);
    console.log(`[Auto-Fix] Broken files: ${brokenFiles.length}`);
    brokenFiles.forEach(f => console.log(`  - ${f} (${errorsByFile[f].length} errors)`));

    const projectStructure = ctx.files.map(f => f.path);
    let fixedCount = 0;
    let failedCount = 0;

    for (const filePath of brokenFiles) {
        const ok = await fixFile(filePath, errorsByFile[filePath], ctx, aiContext, projectStructure);
        if (ok) fixedCount++;
        else failedCount++;
    }

    // SUMMARY
    const summary = getSummary();
    console.log(`\n[Auto-Fix] ═══ SUMMARY ═══`);
    console.log(`[Auto-Fix] Fixed: ${fixedCount}/${brokenFiles.length}`);
    console.log(`[Auto-Fix] Failed: ${failedCount}/${brokenFiles.length}`);
    console.log(`[Auto-Fix] Tokens used this session: ${summary.totalCalls} calls`);

    if (fixedCount === 0) {
        console.log('[Auto-Fix] ❌ Nothing fixed.');
        process.exit(1);
    }
}

main().catch(err => {
    console.error('[Auto-Fix] Fatal:', err);
    process.exit(1);
});
