// ============================================
// FlickZZ Auto-Fixer Script (v5 - Chunked Fix)
// THE GENIUS TRICK: Per-file AI calls with isolated context
// Never hits token limits. Ever.
// ============================================

const fs = require('fs');
const path = require('path');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const PROJECT_DIR = process.cwd();
const ERROR_LOG_FILE = path.join(PROJECT_DIR, 'build.log');

// ═══════════════════════════════════════════
// 1. ANALYZE ERRORS — GROUP BY FILE
// ═══════════════════════════════════════════
function analyzeErrors() {
    if (!fs.existsSync(ERROR_LOG_FILE)) {
        console.log('[Auto-Fix] ❌ build.log not found');
        return null;
    }

    const log = fs.readFileSync(ERROR_LOG_FILE, 'utf-8');
    const lines = log.split('\n');

    // Filter only real compile errors
    const errorLines = lines.filter(l =>
        l.includes('[ERROR]') &&
        (
            l.includes('.java:[') ||
            l.includes('cannot find symbol') ||
            l.includes('reached end of file') ||
            l.includes('class, interface, enum') ||
            l.includes("';' expected") ||
            l.includes('cannot be applied') ||
            l.includes('incompatible types') ||
            l.includes('has private access') ||
            l.includes('is not abstract')
        )
    );

    console.log(`[Auto-Fix] Found ${errorLines.length} compile error lines`);

    // Group errors by file path
    // Pattern: /path/to/File.java:[LINE,COL] ERROR_MESSAGE
    const errorsByFile = {};
    const filePathRegex = /([^\s:]+\.java):\[(\d+),(\d+)\]\s*(.*)$/;

    for (const line of errorLines) {
        const match = line.match(filePathRegex);
        if (!match) continue;

        const fullPath = match[1];
        const lineNum = match[2];
        const colNum = match[3];
        const message = match[4];

        // Convert absolute path to relative
        const relMatch = fullPath.match(/com\/flickzz\/generated\/.*\.java$/);
        if (!relMatch) continue;

        const relPath = 'src/main/java/' + relMatch[0];

        if (!errorsByFile[relPath]) {
            errorsByFile[relPath] = [];
        }
        errorsByFile[relPath].push({
            line: lineNum,
            col: colNum,
            message: message
        });
    }

    return errorsByFile;
}

// ═══════════════════════════════════════════
// 2. AI CALLER — PER FILE (small payload)
// ═══════════════════════════════════════════
async function fixSingleFile(filePath, fileContent, fileErrors) {
    const errorText = fileErrors.map(e =>
        `Line ${e.line}:${e.col} — ${e.message}`
    ).join('\n');

    const prompt = `Fix the Java compilation errors in this file. Return ONLY the complete fixed file content in <file: ${filePath}>content</file> format.

FILE: ${filePath}

ERRORS IN THIS FILE:
${errorText}

COMPLETE FILE CONTENT:
${fileContent}

CRITICAL FIXING RULES:
1. "reached end of file while parsing" → You're missing closing brace(s) }. Count opening { and closing } — they must match.
2. "class, interface, enum, or record expected" → You have EXTRA content after the class's closing brace. Delete everything after the last legitimate }.
3. "cannot find symbol" → Add the missing import at the top of the file.
4. "incompatible types" → Fix the type mismatch.
5. "variable might not have been initialized" → Initialize the variable.
6. "';' expected" → Add the missing semicolon.

Return ONLY this exact format. NO explanation. NO markdown. NO \`\`\`.

<file: ${filePath}>
[complete fixed file content here]
</file>

Paper API 1.21.1, Java 21, Package: com.flickzz.generated`;

    const providers = [
        { name: 'Dahl-MiniMax', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'MiniMaxAI/MiniMax-M2.7' },
        { name: 'Dahl-DeepSeek', url: 'https://inference.dahl.global/v1/chat/completions', key: DAHL_API_KEY, model: 'deepseek-ai/DeepSeek-V4-Flash-0731' },
        { name: 'Nara-Super', url: 'https://router.bynara.id/v1/chat/completions', key: NARA_API_KEY, model: 'nemotron-3-super-free' },
        { name: 'Nara-Ultra', url: 'https://router.bynara.id/v1/chat/completions', key: NARA_API_KEY, model: 'nemotron-3-ultra-free' },
        { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', key: OPENROUTER_API_KEY, model: 'qwen/qwen3-coder:free',
          extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' } }
    ];

    for (const p of providers) {
        if (!p.key) continue;
        try {
            console.log(`[Auto-Fix]   Trying ${p.name}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 90000);

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
                        { role: 'system', content: 'You are a Java code fixer. Output ONLY the file in <file: path>content</file> format. Nothing else.' },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.1,
                    max_tokens: 8000
                })
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                console.log(`[Auto-Fix]   ${p.name} HTTP ${res.status}`);
                continue;
            }

            const contentType = res.headers.get('content-type') || '';
            if (!contentType.includes('application/json')) {
                console.log(`[Auto-Fix]   ${p.name} non-JSON response`);
                continue;
            }

            const data = await res.json();
            const text = data.choices?.[0]?.message?.content || '';
            if (!text || text.length < 30) {
                console.log(`[Auto-Fix]   ${p.name} empty response`);
                continue;
            }

            // Parse fixed file
            const parts = text.split(/<file:\s*/);
            parts.shift();

            for (const part of parts) {
                const lines = part.split('\n');
                let returnedPath = lines[0].replace(/>.*$/, '').trim();
                let content = lines.slice(1).join('\n').trim();
                content = content.replace(/<\/file>\s*$/, '').trim();

                if (content && content.length > 30) {
                    console.log(`[Auto-Fix]   ✅ ${p.name} fixed (${content.length} chars)`);
                    return content;
                }
            }
            console.log(`[Auto-Fix]   ${p.name} parse failed`);
        } catch (err) {
            console.log(`[Auto-Fix]   ${p.name} error: ${err.message}`);
        }
    }

    return null; // All providers failed for this file
}

// ═══════════════════════════════════════════
// 3. MAIN — CHUNKED FIX
// ═══════════════════════════════════════════
async function main() {
    console.log('\n═══ AUTO-FIX STARTED (v5 — Chunked) ═══');

    const errorsByFile = analyzeErrors();
    if (!errorsByFile) {
        console.log('[Auto-Fix] ❌ No errors found. Exiting.');
        process.exit(1);
    }

    const brokenFiles = Object.keys(errorsByFile);
    console.log(`[Auto-Fix] Broken files: ${brokenFiles.length}`);
    brokenFiles.forEach(f => {
        console.log(`  - ${f} (${errorsByFile[f].length} errors)`);
    });

    let fixedCount = 0;
    let failedCount = 0;

    // 🎯 THE GENIUS: Fix each file individually
    for (const filePath of brokenFiles) {
        console.log(`\n[Auto-Fix] ═══ Fixing: ${filePath} ═══`);

        const fullPath = path.join(PROJECT_DIR, filePath);
        if (!fs.existsSync(fullPath)) {
            console.log(`[Auto-Fix] ❌ File not found: ${filePath}`);
            failedCount++;
            continue;
        }

        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        console.log(`[Auto-Fix] Original size: ${fileContent.length} chars`);

        const fixedContent = await fixSingleFile(
            filePath,
            fileContent,
            errorsByFile[filePath]
        );

        if (fixedContent) {
            fs.writeFileSync(fullPath, fixedContent, 'utf-8');
            console.log(`[Auto-Fix] 💾 Saved: ${filePath}`);
            fixedCount++;
        } else {
            console.log(`[Auto-Fix] ❌ Could not fix: ${filePath} (all providers failed)`);
            failedCount++;
        }
    }

    console.log(`\n[Auto-Fix] ═══ SUMMARY ═══`);
    console.log(`[Auto-Fix] Fixed: ${fixedCount}/${brokenFiles.length}`);
    console.log(`[Auto-Fix] Failed: ${failedCount}/${brokenFiles.length}`);

    if (fixedCount === 0) {
        console.log('[Auto-Fix] ❌ No files fixed. Cannot retry build.');
        process.exit(1);
    }

    if (failedCount > 0) {
        console.log(`[Auto-Fix] ⚠️  ${failedCount} file(s) still broken. Build may fail again.`);
    } else {
        console.log(`[Auto-Fix] ✅ All broken files fixed!`);
    }
}

main().catch(err => {
    console.error('[Auto-Fix] Fatal:', err);
    process.exit(1);
});
