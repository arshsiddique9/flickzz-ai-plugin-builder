// scripts/agent-loop.js
// Real agentic loop — tries ALL working providers before giving up

const { TOOL_SCHEMAS, executeTool } = require('./agent-tools');
const { selectWorkingProvider, invalidateProvider, PROVIDERS } = require('./free-models');

const SYSTEM_PROMPT = `You are an autonomous coding agent fixing a Minecraft Bukkit/Paper plugin (PaperMC 1.21.1, Java 21).

Tools:
- read_file(path) · write_file(path, content) · list_files(path) · run_command(cmd) · task_complete(success, summary)

MISSION: Get the Maven build to pass.

WORKFLOW:
1. Run: mvn -B clean package -DskipTests 2>&1 | tail -60
2. Read errors. Note file + line.
3. read_file → see problematic code.
4. write_file → fix. Correct Java syntax.
5. Recompile. Repeat.
6. task_complete(true, "summary") when build succeeds.

JAVA RULES:
- Every { matches }
- Method signatures: public ReturnType name(params) { ... }
- Statements end with ;
- Package FIRST line, imports after
- No code AFTER final class brace

Start by running the build command.`;

// ═══════════════════════════════════════════
// Detect HTML response (means endpoint redirected/broke)
// ═══════════════════════════════════════════
function looksLikeHtml(text) {
    if (!text) return false;
    const t = text.trim().slice(0, 100).toLowerCase();
    return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml');
}

// ═══════════════════════════════════════════
// Call provider (with HTML & rate-limit detection)
// ═══════════════════════════════════════════
async function callProvider(provider, model, messages, tools) {
    const apiKey = process.env[provider.keyEnv];
    if (!apiKey) throw new Error(`Missing ${provider.keyEnv}`);

    const res = await fetch(provider.url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://flickzz.qzz.io',
            'X-Title': 'FlickZZ Agentic Builder'
        },
        body: JSON.stringify({
            model,
            messages,
            tools,
            tool_choice: 'auto',
            max_tokens: 4096,
            temperature: 0.2
        })
    });

    if (!res.ok) {
        const errText = (await res.text()).slice(0, 400);
        const err = new Error(`HTTP ${res.status}: ${errText}`);
        err.status = res.status;
        err.isRateLimit = res.status === 429;
        throw err;
    }

    const rawText = await res.text();

    // Detect HTML response (endpoint broken)
    if (looksLikeHtml(rawText)) {
        const err = new Error(`Provider returned HTML instead of JSON (endpoint broken)`);
        err.isHtml = true;
        throw err;
    }

    let data;
    try {
        data = JSON.parse(rawText);
    } catch (e) {
        throw new Error(`Invalid JSON: ${rawText.slice(0, 200)}`);
    }

    if (!data.choices || !data.choices[0]) {
        throw new Error(`No choices in response: ${rawText.slice(0, 200)}`);
    }

    return data.choices[0].message;
}

// ═══════════════════════════════════════════
// Build a shuffled queue of all working providers
// ═══════════════════════════════════════════
async function buildProviderQueue() {
    const queue = [];
    const cache = require('fs').existsSync(process.env.WORKSPACE_ROOT + '/.free-model-cache.json')
        ? JSON.parse(require('fs').readFileSync(process.env.WORKSPACE_ROOT + '/.free-model-cache.json', 'utf8'))
        : {};

    // First: all cached providers
    for (const provider of PROVIDERS) {
        if (cache[provider.id]?.model && process.env[provider.keyEnv]) {
            queue.push({ provider, model: cache[provider.id].model });
        }
    }

    // If queue is empty, do a full probe
    if (queue.length === 0) {
        console.log(`[Agent] No cached providers, probing...`);
        const { probeAll } = require('./free-models');
        const results = await probeAll();
        for (const r of results) {
            if (r.status === 'WORKING') {
                const provider = PROVIDERS.find(p => p.name === r.provider);
                if (provider) queue.push({ provider, model: r.model });
            }
        }
    }

    return queue;
}

// ═══════════════════════════════════════════
// Agent main loop
// ═══════════════════════════════════════════
async function runAgent(initialPrompt, maxSteps = 25) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 AGENT STARTED — max ${maxSteps} steps`);
    console.log(`${'═'.repeat(60)}\n`);

    // Build a queue of ALL working providers
    const providerQueue = await buildProviderQueue();

    if (providerQueue.length === 0) {
        console.log(`[Agent] ❌ No working providers found.`);
        return { success: false, reason: 'No provider' };
    }

    console.log(`[Agent] ✅ Queue: ${providerQueue.map(p => p.provider.name).join(' → ')}\n`);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: initialPrompt || 'Fix the build.' }
    ];

    let currentIdx = 0;
    let failureCount = {}; // provider.id → count of consecutive failures

    for (let step = 1; step <= maxSteps; step++) {
        console.log(`\n━━━ STEP ${step}/${maxSteps} ━━━`);

        let assistantMsg = null;
        let triedCount = 0;
        const maxTriesPerStep = providerQueue.length; // try ALL

        // Try providers in rotation until one works
        while (triedCount < maxTriesPerStep && !assistantMsg) {
            const { provider, model } = providerQueue[currentIdx % providerQueue.length];
            console.log(`[Agent] 🧠 ${provider.name} / ${model}`);

            try {
                assistantMsg = await callProvider(provider, model, messages, TOOL_SCHEMAS);
                failureCount[provider.id] = 0;
            } catch (err) {
                console.log(`[Agent] ⚠️ ${provider.name} failed: ${err.message.slice(0, 180)}`);
                failureCount[provider.id] = (failureCount[provider.id] || 0) + 1;

                // HTML or 404 → invalidate cache so we don't retry
                if (err.isHtml || (err.message && err.message.includes('404'))) {
                    invalidateProvider(provider.id);
                }

                // Rate limit → wait briefly (only on last provider)
                if (err.isRateLimit && triedCount === maxTriesPerStep - 1) {
                    console.log(`[Agent] ⏱️ Rate limit — waiting 30s before retry...`);
                    await new Promise(r => setTimeout(r, 30000));
                }

                triedCount++;
                currentIdx++;

                // Move to next provider
                continue;
            }
        }

        if (!assistantMsg) {
            console.log(`[Agent] ❌ All ${providerQueue.length} providers failed this step.`);
            return { success: false, reason: 'All providers failed' };
        }

        // Push assistant message
        messages.push({
            role: 'assistant',
            content: assistantMsg.content || '',
            tool_calls: assistantMsg.tool_calls || undefined
        });

        if (assistantMsg.content) {
            console.log(`[Agent] 💬 ${assistantMsg.content.slice(0, 250)}`);
        }

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
            console.log(`[Agent] 🤷 No tool calls. Agent stopped.`);
            return { success: false, reason: 'Agent stopped' };
        }

        // Execute tool calls
        for (const tc of assistantMsg.tool_calls) {
            const toolName = tc.function.name;
            let toolArgs = {};
            try { toolArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

            console.log(`[Agent] 🔧 ${toolName}(${JSON.stringify(toolArgs).slice(0, 120)})`);

            const result = executeTool(toolName, toolArgs);
            console.log(`[Agent] 📤 ${JSON.stringify(result).slice(0, 200)}`);

            if (toolName === 'task_complete') {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`✅ DONE: ${toolArgs.summary}`);
                console.log(`${'═'.repeat(60)}\n`);
                return { success: toolArgs.success, summary: toolArgs.summary };
            }

            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result).slice(0, 6000)
            });
        }

        // Context management
        if (messages.length > 32) {
            const sys = messages[0];
            const recent = messages.slice(-30);
            messages.length = 0;
            messages.push(sys, ...recent);
        }
    }

    return { success: false, reason: 'Max steps reached' };
}

module.exports = { runAgent };
