// scripts/providers.js

const { getFixerPrompt } = require('./agents');

// 🎯 SMART ROUTING: DeepSeek for complex fixes, GPT-6 Luna for fast ones
const PROVIDERS = [
    // 🆕 APINEX - Primary Provider (Best Coding Models)
    { 
        name: "APINEX-DeepSeek", 
        url: "https://api.apinex.bond/v1/chat/completions", 
        model: "free/deepseek-v4-pro", 
        apiKeyEnv: "APINEX_API_KEY", 
        maxTokens: 8192 
    },
    { 
        name: "APINEX-GPT6", 
        url: "https://api.apinex.bond/v1/chat/completions", 
        model: "free/gpt-6-luna", 
        apiKeyEnv: "APINEX_API_KEY", 
        maxTokens: 8192 
    },
    // 🛡️ Fallback Providers (Keep as backup)
    { name: "OpenRouter-Qwen", url: "https://openrouter.ai/api/v1/chat/completions", model: "qwen/qwen-2.5-coder-32b-instruct", apiKeyEnv: "OPENROUTER_API_KEY", maxTokens: 4096 },
    { name: "UNOROUTER", url: "https://api.unorouter.com/v1/chat/completions", model: "gemini-3.5-flash-lite:free", apiKeyEnv: "UNOROUTER_API_KEY", maxTokens: 4096 },
    { name: "TokenHarbor", url: "https://api.tokenharbor.ai/v1/chat/completions", model: "qwen3.8-flash:free", apiKeyEnv: "TOKENHARBOR_API_KEY", maxTokens: 4096 }
];

async function executeProviderCall(provider, prompt) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) throw new Error(`API Key missing: ${provider.apiKeyEnv}`);

    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    let body = { model: provider.model, max_tokens: provider.maxTokens, messages: [{ role: "user", content: prompt }] };

    const response = await fetch(provider.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data = await response.json();
    let content = data.choices[0].message.content;
    return content.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
}

/**
 * Fix code with context and error log (standard repair flow)
 */
async function fixCodeWithProviders(code, fileName, projectContext = "", errorLog = "", plan = "") {
    const MAX_SIZE_FOR_AI = 50000;
    let contentToSend = code, isPreview = false;

    if (code.length > MAX_SIZE_FOR_AI) {
        contentToSend = code.substring(0, MAX_SIZE_FOR_AI) + "\n\n... [TRUNCATED] ...";
        isPreview = true;
    }

    const prompt = getFixerPrompt(projectContext, errorLog, fileName, contentToSend, plan);

    for (const provider of PROVIDERS) {
        try {
            console.log(`[Agentic] Coder Agent trying ${provider.name} for ${fileName}...`);
            const fixedCode = await executeProviderCall(provider, prompt);
            if (fixedCode) return { success: true, fixedCode, provider: provider.name };
        } catch (error) {
            console.error(`[Provider Failure] ${provider.name}: ${error.message}`);
        }
    }
    return { success: false, fixedCode: code, provider: null };
}

/**
 * 🆕 RAW CODE GENERATOR (For Missing Files)
 */
async function generateRawCode(prompt) {
    for (const provider of PROVIDERS) {
        try {
            console.log(`[Raw Gen] Trying ${provider.name}...`);
            const code = await executeProviderCall(provider, prompt);
            if (code && code.length > 20) {
                return { success: true, code, provider: provider.name };
            }
        } catch (error) {
            console.error(`[Raw Gen Fail] ${provider.name}: ${error.message}`);
        }
    }
    return { success: false, code: null, provider: null };
}

module.exports = { fixCodeWithProviders, generateRawCode, PROVIDERS };
