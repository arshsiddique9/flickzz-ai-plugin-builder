// scripts/agent-loop.js
// Real agentic loop with LIVE PROGRESS CALLBACKS

const { TOOL_SCHEMAS, executeTool } = require('./agent-tools');
const { selectWorkingProvider, invalidateProvider, PROVIDERS } = require('./free-models');

const CALLBACK_URL = process.env.CALLBACK_URL || '';
const BUILD_ID = process.env.BUILD_ID || '';

async function sendProgress(payload) {
    if (!CALLBACK_URL || !BUILD_ID) return;
    try {
        await fetch(CALLBACK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ build_id: BUILD_ID, ...payload })
        });
    } catch (e) {
        console.warn(`[Progress] Callback failed: ${e.message}`);
    }
}

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

function looksLikeHtml(text) {
    if (!text) return false;
    const t = text.trim().slice(0, 100).toLowerCase();
    return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml');
}

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
            model, messages, tools,
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

    if (looksLikeHtml(rawText)) {
        const err = new Error(`Provider returned HTML (endpoint broken)`);
        err.isHtml = true;
        throw err;
    }

    let data;
    try { data = JSON.parse(rawText); }
    catch (e) { throw new Error(`Invalid JSON: ${rawText.slice(0, 200)}`); }

    if (!data.choices || !data.choices[0]) {
        throw new Error(`No choices: ${rawText.slice(0, 200)}`);
    }

    return data.choices[0].message;
}

async function buildProviderQueue() {
    const queue = [];
    const cacheFile = process.env.WORKSPACE_ROOT + '/.free-model-cache.json';
    let cache = {};
    try {
        if (require('fs').existsSync(cacheFile)) {
            cache = JSON.parse(require('fs').readFileSync(cacheFile, 'utf8'));
        }
    } catch {}

    for (const provider of PROVIDERS) {
        if (cache[provider.id]?.model && process.env[provider.keyEnv]) {
            queue.push({ provider, model: cache[provider.id].model });
        }
    }

    if (queue.length === 0) {
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

async function runAgent(initialPrompt, maxSteps = 25) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 AGENT STARTED — max ${maxSteps} steps`);
    console.log(`${'═'.repeat(60)}\n`);

    const providerQueue = await buildProviderQueue();
    if (providerQueue.length === 0) {
        await sendProgress({ status: 'agent_failed', error: 'No working providers' });
        return { success: false, reason: 'No provider' };
    }

    console.log(`[Agent] ✅ Queue: ${providerQueue.map(p => p.provider.name).join(' → ')}\n`);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: initialPrompt || 'Fix the build.' }
    ];

    let currentIdx = 0;

    for (let step = 1; step <= maxSteps; step++) {
        console.log(`\n━━━ STEP ${step}/${maxSteps} ━━━`);

        // 🆕 LIVE PROGRESS — bhejo har step ka start
        await sendProgress({
            status: 'agent_step',
            step: step,
            total: maxSteps,
            stage: 'thinking',
            message: `Step ${step}/${maxSteps} — thinking...`
        });

        let assistantMsg = null;
        let triedCount = 0;
        const maxTries = providerQueue.length;
        let usedProvider = null;

        while (triedCount < maxTries && !assistantMsg) {
            const { provider, model } = providerQueue[currentIdx % providerQueue.length];
            console.log(`[Agent] 🧠 ${provider.name} / ${model}`);

            try {
                assistantMsg = await callProvider(provider, model, messages, TOOL_SCHEMAS);
                usedProvider = { provider, model };
            } catch (err) {
                console.log(`[Agent] ⚠️ ${provider.name} failed: ${err.message.slice(0, 180)}`);

                if (err.isHtml || (err.message && err.message.includes('404'))) {
                    invalidateProvider(provider.id);
                }
                if (err.isRateLimit && triedCount === maxTries - 1) {
                    console.log(`[Agent] ⏱️ Rate limit — waiting 30s...`);
                    await new Promise(r => setTimeout(r, 30000));
                }

                triedCount++;
                currentIdx++;
            }
        }

        if (!assistantMsg) {
            await sendProgress({
                status: 'agent_failed',
                step,
                error: 'All providers failed at this step'
            });
            return { success: false, reason: 'All providers failed' };
        }

        messages.push({
            role: 'assistant',
            content: assistantMsg.content || '',
            tool_calls: assistantMsg.tool_calls || undefined
        });

        if (assistantMsg.content) {
            console.log(`[Agent] 💬 ${assistantMsg.content.slice(0, 250)}`);
        }

        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
            await sendProgress({ status: 'agent_failed', step, error: 'Agent stopped' });
            return { success: false, reason: 'Agent stopped' };
        }

        // 🆕 Execute tool calls with live updates
        for (const tc of assistantMsg.tool_calls) {
            const toolName = tc.function.name;
            let toolArgs = {};
            try { toolArgs = JSON.parse(tc.function.arguments || '{}'); } catch {}

            console.log(`[Agent] 🔧 ${toolName}(${JSON.stringify(toolArgs).slice(0, 120)})`);

            // 🆕 Update before executing tool
            await sendProgress({
                status: 'agent_step',
                step,
                total: maxSteps,
                stage: 'executing',
                tool: toolName,
                model: usedProvider?.model || 'unknown',
                message: `${toolName}(${JSON.stringify(toolArgs).slice(0, 60)})`
            });

            const result = executeTool(toolName, toolArgs);
            console.log(`[Agent] 📤 ${JSON.stringify(result).slice(0, 200)}`);

            if (toolName === 'task_complete') {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`✅ DONE: ${toolArgs.summary}`);
                console.log(`${'═'.repeat(60)}\n`);

                await sendProgress({
                    status: 'agent_done',
                    step,
                    success: toolArgs.success,
                    summary: toolArgs.summary,
                    model: usedProvider?.model
                });

                return { success: toolArgs.success, summary: toolArgs.summary };
            }

            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result).slice(0, 6000)
            });
        }

        if (messages.length > 32) {
            const sys = messages[0];
            const recent = messages.slice(-30);
            messages.length = 0;
            messages.push(sys, ...recent);
        }
    }

    await sendProgress({ status: 'agent_failed', error: 'Max steps reached' });
    return { success: false, reason: 'Max steps reached' };
}

module.exports = { runAgent };
