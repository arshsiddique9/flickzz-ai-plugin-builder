// ═══════════════════════════════════════════
// FlickZZ Builder AI — GitHub Actions Script
// ═══════════════════════════════════════════

const fs = require('fs');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const PROMPT = process.env.PROMPT;
const IS_CHAT = process.env.IS_CHAT === 'true';

const SYSTEM_PROMPT = `You are FlickZZ Builder AI — the official AI assistant of FlickZZ Resources, created by Arsh Siddique.

🔥 IDENTITY (NEVER BREAK):
- Name: FlickZZ Builder AI
- Creator: Arsh Siddique (FlickZZ Resources)
- NEVER mention: OpenAI, Claude, GPT, Gemini, Nara Router, OpenRouter, any model/company
- If asked: "Main FlickZZ Builder AI hoon, Arsh Siddique ne banaya hai."

🚀 COMPILE SYSTEM:
- User plugin describe kare → main code generate karun
- Right side "Compile & Download JAR" button → GitHub Actions → JAR download
- Compile error aaye toh AI auto-fix karega (3 attempts tak)
- Kabhi mat bol "compiler nahi hai" — HAMESHA bol "Compile button hai, click karo"

🎯 THREE MODES:
1. CHAT (greeting): Friendly reply, NO code
2. DISCUSSION (questions): Explain, NO code
3. BUILD (plugin request): Full Maven project

🚨 CRITICAL TOKEN RULE:
- Main Class (onEnable, onDisable, commands, listeners) FIRST likho
- Faltu comments/blank lines mat likho

🚨 HTML ESCAPING RULE:
- Use LITERAL < and > characters. NEVER escape them.

🚫 NEVER ECHO USER PROMPT:
- NEVER repeat user's message back.

📋 BUILD MODE RESPONSE FORMAT:
---
EXPLANATION: <1-2 sentences>
PLUGIN_NAME: <ClassName>
<file: pom.xml>
<pom.xml content>
</file>
<file: src/main/resources/plugin.yml>
<plugin.yml content>
</file>
<file: src/main/java/com/flickzz/generated/<ClassName>.java>
<Java code with ALL imports>
</file>
---

🚨 RESPONSE FORMAT RULES:
1. Use LITERAL <file: PATH> and </file> tags.
2. Do NOT wrap file contents in markdown code blocks.
3. Do NOT escape < and > characters.
4. Start response with --- and end with --- in BUILD mode.

FINAL RULES:
- Match user language (Hindi/Hinglish/English)
- Paper API 1.21.1, Java 21
- Package: com.flickzz.generated
- Include ALL imports
- Stay in character as FlickZZ Builder AI

${IS_CHAT ? 'CHAT/DISCUSSION MODE — NO CODE' : 'BUILD MODE if plugin request is clear'}`;

async function tryProvider(provider, messages, systemPrompt, isChat) {
    const targetTokens = isChat ? 800 : 16384;
    const PER_MODEL_TIMEOUT_MS = isChat ? 20000 : 240000;

    const configs = {
        dahl: {
            url: 'https://inference.dahl.global/v1/chat/completions',
            key: DAHL_API_KEY,
            models: ['MiniMaxAI/MiniMax-M2.7', 'deepseek-ai/DeepSeek-V4-Flash-0731']
        },
        nara: {
            url: 'https://router.bynara.id/v1/chat/completions',
            key: NARA_API_KEY,
            models: ['nemotron-3-ultra-free', 'nemotron-3-super-free']
        },
        openrouter: {
            url: 'https://openrouter.ai/api/v1/chat/completions',
            key: OPENROUTER_API_KEY,
            models: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'qwen/qwen3-coder:free']
        }
    };

    const cfg = configs[provider];
    if (!cfg || !cfg.key) {
        console.log(`⚠️ ${provider} API key missing`);
        return { ok: false, error: `${provider} API key missing` };
    }

    let lastError = '';

    for (const model of cfg.models) {
        try {
            console.log(`[${provider}] Trying: ${model}`);

            const headers = {
                'Authorization': `Bearer ${cfg.key}`,
                'Content-Type': 'application/json'
            };

            if (provider === 'openrouter') {
                headers['HTTP-Referer'] = 'https://flickzz.qzz.io';
                headers['X-Title'] = 'FlickZZ Builder';
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), PER_MODEL_TIMEOUT_MS);

            const res = await fetch(cfg.url, {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    model,
                    messages: [{ role: 'system', content: systemPrompt }, ...messages],
                    temperature: 0.3,
                    max_tokens: targetTokens,
                    top_p: 0.9
                })
            });
            clearTimeout(timeoutId);

            if (res.ok) {
                const data = await res.json();
                const choice = data.choices?.[0];
                const content = choice?.message?.content || '';
                const finishReason = choice?.finish_reason || 'unknown';

                if (content.trim().length === 0) {
                    lastError = `${model}: empty`;
                    continue;
                }

                if (!isChat && finishReason === 'length') {
                    lastError = `${model}: token limit`;
                    continue;
                }

                console.log(`✅ [${provider}] Success: ${model}`);
                return { ok: true, content };
            } else {
                lastError = `${res.status}: ${(await res.text()).substring(0, 100)}`;
                console.log(`❌ [${provider}] ${model} failed: ${lastError}`);
            }
        } catch (err) {
            lastError = err.message;
            console.log(`❌ [${provider}] ${model} threw: ${err.message}`);
        }
    }

    return { ok: false, error: `${provider} all failed: ${lastError}` };
}

async function main() {
    const messages = [{ role: 'user', content: PROMPT }];

    let result = await tryProvider('dahl', messages, SYSTEM_PROMPT, IS_CHAT);
    if (!result.ok) {
        console.log('⏭️ Dahl failed, trying Nara...');
        result = await tryProvider('nara', messages, SYSTEM_PROMPT, IS_CHAT);
    }
    if (!result.ok) {
        console.log('⏭️ Nara failed, trying OpenRouter...');
        result = await tryProvider('openrouter', messages, SYSTEM_PROMPT, IS_CHAT);
    }

    if (!result.ok) {
        console.error('❌ All providers failed:', result.error);
        process.exit(1);
    }

    // Save result to file for next step
    fs.writeFileSync('ai-result.txt', result.content);
    console.log('✅ Result saved to ai-result.txt');

    // Set output for next step
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `result_file=ai-result.txt\n`);
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
