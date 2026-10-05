// scripts/agent-loop.js
// Real agentic loop with auto model selection across free providers

const { TOOL_SCHEMAS, executeTool } = require('./agent-tools');
const { selectWorkingProvider, invalidateProvider } = require('./free-models');

const SYSTEM_PROMPT = `You are an autonomous coding agent fixing a Minecraft Bukkit/Paper plugin (PaperMC 1.21.1, Java 21).

You have these tools:
- read_file(path): Read any file in the workspace
- write_file(path, content): Write/overwrite a file
- list_files(path): List all files
- run_command(cmd): Run shell commands like 'mvn -B clean package -DskipTests'
- task_complete(success, summary): Call when done

YOUR MISSION: Get the Maven build to pass by finding and fixing compile errors.

━━━ WORKFLOW ━━━
1. Run: mvn -B clean package -DskipTests 2>&1 | tail -60
2. Read the error output. Note file paths and line numbers.
3. Use read_file to see the problematic code.
4. Fix with write_file. Make sure the fix is CORRECT Java syntax.
5. Run mvn again. Repeat until build passes.
6. Call task_complete(true, "summary").

━━━ JAVA SYNTAX RULES ━━━
- Every { needs matching }
- Method signatures: public ReturnType name(params) { ... }
- Every statement ends with ;
- Package declaration is FIRST line
- Never write code AFTER the final class closing brace
- Imports at top: import org.bukkit.X;

━━━ EFFICIENCY ━━━
- Fix ONE error at a time
- Trust the compiler's line numbers
- Don't read files you don't need

START by running the build command.`;

// ═══════════════════════════════════════════
// Call provider with tools (OpenAI format)
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
        throw new Error(`HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    return data.choices[0].message;
}

// ═══════════════════════════════════════════
// Main Agent Loop
// ═══════════════════════════════════════════
async function runAgent(initialPrompt, maxSteps = 25) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 AGENT STARTED — max ${maxSteps} steps`);
    console.log(`${'═'.repeat(60)}\n`);

    // ── Step 1: Select working provider ──
    console.log(`[Agent] 🔎 Auto-detecting working provider...`);
    let selection = await selectWorkingProvider();
    if (!selection) {
        console.log(`[Agent] ❌ No working provider found. Check API keys.`);
        return { success: false, reason: 'No provider' };
    }
    console.log(`[Agent] ✅ Using ${selection.provider.name} / ${selection.model}\n`);

    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: initialPrompt || 'Fix the build.' }
    ];

    let currentProvider = selection.provider;
    let currentModel = selection.model;

    for (let step = 1; step <= maxSteps; step++) {
        console.log(`\n━━━ STEP ${step}/${maxSteps} ━━━`);
        console.log(`[Agent] 🧠 ${currentProvider.name} / ${currentModel}`);

        let assistantMsg = null;
        let attempts = 0;

        // Try current provider, then auto-switch on failure
        while (attempts < 2 && !assistantMsg) {
            try {
                assistantMsg = await callProvider(currentProvider, currentModel, messages, TOOL_SCHEMAS);
            } catch (err) {
                console.log(`[Agent] ⚠️ ${currentProvider.name} failed: ${err.message.slice(0, 200)}`);
                invalidateProvider(currentProvider.id);
                attempts++;

                if (attempts < 2) {
                    console.log(`[Agent] 🔄 Switching provider...`);
                    const next = await selectWorkingProvider();
                    if (!next) {
                        console.log(`[Agent] ❌ No alternate provider. Stopping.`);
                        return { success: false, reason: 'All providers failed' };
                    }
                    currentProvider = next.provider;
                    currentModel = next.model;
                    console.log(`[Agent] ✅ Now using ${currentProvider.name} / ${currentModel}`);
                }
            }
        }

        if (!assistantMsg) {
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
            console.log(`[Agent] 🤷 No tool calls. Agent stopped.`);
            return { success: false, reason: 'Agent stopped' };
        }

        for (const tc of assistantMsg.tool_calls) {
            const toolName = tc.function.name;
            let toolArgs = {};
            try {
                toolArgs = JSON.parse(tc.function.arguments || '{}');
            } catch {}

            console.log(`[Agent] 🔧 ${toolName}(${JSON.stringify(toolArgs).slice(0, 150)})`);

            const result = executeTool(toolName, toolArgs);
            console.log(`[Agent] 📤 ${JSON.stringify(result).slice(0, 250)}`);

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

        // Context window management
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
