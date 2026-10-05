// scripts/agent-loop.js
// Real agentic loop with tool calling

const { TOOL_SCHEMAS, executeTool } = require('./agent-tools');

const PROVIDERS = [
    {
        name: "OpenRouter-Qwen",
        url: "https://openrouter.ai/api/v1/chat/completions",
        model: "qwen/qwen-2.5-coder-32b-instruct",
        apiKeyEnv: "OPENROUTER_API_KEY"
    },
    {
        name: "OpenAI-GPT4o",
        url: "https://api.openai.com/v1/chat/completions",
        model: "gpt-4o",
        apiKeyEnv: "OPENAI_API_KEY"
    },
    {
        name: "Anthropic-Claude",
        url: "https://api.anthropic.com/v1/messages",
        model: "claude-3-5-sonnet-20240620",
        apiKeyEnv: "ANTHROPIC_API_KEY"
    }
];

const SYSTEM_PROMPT = `You are an autonomous coding agent fixing a Minecraft Bukkit/Paper plugin (PaperMC 1.21.1, Java 21).

You have these tools:
- read_file(path): Read any file in the workspace
- write_file(path, content): Write/overwrite a file
- list_files(path): List all files
- run_command(cmd): Run shell commands like 'mvn -B compile' or 'mvn -B clean package -DskipTests'
- task_complete(success, summary): Call when done

YOUR MISSION: Get the Maven build to pass by finding and fixing compile errors.

━━━ WORKFLOW ━━━
1. First, run: mvn -B clean package -DskipTests 2>&1 | tail -50
2. Read the error output carefully. Note the file paths and line numbers.
3. Use read_file to see the problematic code.
4. Fix it with write_file. Make sure the fix is CORRECT Java syntax.
5. Run mvn again to verify. Repeat until build passes.
6. Call task_complete(true, "summary") when build succeeds.

━━━ JAVA SYNTAX RULES (CRITICAL) ━━━
- Every { needs matching }
- Method signatures: public ReturnType name(params) { ... }
- Every statement ends with ;
- Package declaration is FIRST line
- Never write code AFTER the final class closing brace
- Imports must be at top: import org.bukkit.X;
- No markdown fences in write_file content — just raw Java

━━━ EFFICIENCY RULES ━━━
- Don't read files you don't need
- Fix ONE error at a time if there are many
- If a file has syntax issues, rewrite it cleanly
- Trust the compiler — its line numbers are accurate

START by running the build command.`;

async function callProvider(provider, messages, tools) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) throw new Error(`Missing API key: ${provider.apiKeyEnv}`);

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    let body = {
        model: provider.model,
        messages,
        tools,
        tool_choice: 'auto',
        max_tokens: 4096,
        temperature: 0.2
    };

    if (provider.name.includes('Anthropic')) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        delete headers['Authorization'];
        body = {
            model: provider.model,
            messages: messages.filter(m => m.role !== 'system'),
            system: messages.find(m => m.role === 'system')?.content || '',
            tools: tools.map(t => ({
                name: t.function.name,
                description: t.function.description,
                input_schema: t.function.parameters
            })),
            max_tokens: 4096
        };
    }

    const res = await fetch(provider.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();

    // Normalize to OpenAI format
    if (provider.name.includes('Anthropic')) {
        const content = data.content || [];
        const textBlock = content.find(c => c.type === 'text');
        const toolUses = content.filter(c => c.type === 'tool_use');
        return {
            role: 'assistant',
            content: textBlock?.text || null,
            tool_calls: toolUses.map(tu => ({
                id: tu.id,
                type: 'function',
                function: {
                    name: tu.name,
                    arguments: JSON.stringify(tu.input)
                }
            }))
        };
    }

    return data.choices[0].message;
}

async function runAgent(initialPrompt, maxSteps = 25) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: initialPrompt || 'Fix the build. Start by running the build command.' }
    ];

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🤖 AGENT STARTED — max ${maxSteps} steps`);
    console.log(`${'═'.repeat(60)}\n`);

    for (let step = 1; step <= maxSteps; step++) {
        console.log(`\n━━━ STEP ${step}/${maxSteps} ━━━`);

        let assistantMsg = null;
        let usedProvider = null;

        // Try each provider
        for (const provider of PROVIDERS) {
            try {
                console.log(`[Agent] 🤔 Thinking with ${provider.name}...`);
                assistantMsg = await callProvider(provider, messages, TOOL_SCHEMAS);
                usedProvider = provider.name;
                break;
            } catch (err) {
                console.log(`[Agent] ⚠️ ${provider.name} failed: ${err.message.slice(0, 150)}`);
            }
        }

        if (!assistantMsg) {
            console.log(`[Agent] ❌ All providers failed. Stopping.`);
            return { success: false, reason: 'No provider available' };
        }

        // Push assistant message
        messages.push({
            role: 'assistant',
            content: assistantMsg.content || '',
            tool_calls: assistantMsg.tool_calls || undefined
        });

        if (assistantMsg.content) {
            console.log(`[Agent] 💬 ${assistantMsg.content.slice(0, 300)}`);
        }

        // No tool calls = agent is just talking
        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
            console.log(`[Agent] 🤷 No tool calls. Agent stopped.`);
            return { success: false, reason: 'Agent stopped without completing' };
        }

        // Execute each tool call
        for (const tc of assistantMsg.tool_calls) {
            const toolName = tc.function.name;
            let toolArgs = {};
            try {
                toolArgs = JSON.parse(tc.function.arguments || '{}');
            } catch (e) {
                toolArgs = {};
            }

            console.log(`[Agent] 🔧 ${toolName}(${JSON.stringify(toolArgs).slice(0, 200)})`);

            const result = executeTool(toolName, toolArgs);

            // Log a preview
            const preview = JSON.stringify(result).slice(0, 300);
            console.log(`[Agent] 📤 ${preview}`);

            // Special: task_complete ends the loop
            if (toolName === 'task_complete') {
                console.log(`\n${'═'.repeat(60)}`);
                console.log(`✅ AGENT COMPLETE: ${toolArgs.summary}`);
                console.log(`${'═'.repeat(60)}\n`);
                return { success: toolArgs.success, summary: toolArgs.summary };
            }

            // Add tool result to conversation
            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: JSON.stringify(result).slice(0, 6000)
            });
        }

        // Context management: keep last 30 messages + system
        if (messages.length > 32) {
            const system = messages[0];
            const recent = messages.slice(-30);
            messages.length = 0;
            messages.push(system, ...recent);
        }
    }

    console.log(`[Agent] ⏱️ Max steps (${maxSteps}) reached.`);
    return { success: false, reason: 'Max steps reached' };
}

module.exports = { runAgent };
