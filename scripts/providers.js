// scripts/providers.js

const { getFixerPrompt } = require('./agents'); // 🆕 Import agent

const PROVIDERS = [
    { name: "OpenRouter-Qwen", url: "https://openrouter.ai/api/v1/chat/completions", model: "qwen/qwen-2.5-coder-32b-instruct", apiKeyEnv: "OPENROUTER_API_KEY", maxTokens: 4096 },
    { name: "OpenAI-GPT4o", url: "https://api.openai.com/v1/chat/completions", model: "gpt-4o", apiKeyEnv: "OPENAI_API_KEY", maxTokens: 4096 },
    { name: "Anthropic-Claude", url: "https://api.anthropic.com/v1/messages", model: "claude-3-5-sonnet-20240620", apiKeyEnv: "ANTHROPIC_API_KEY", maxTokens: 4096 }
];

async function executeProviderCall(provider, prompt) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) throw new Error(`API Key missing: ${provider.apiKeyEnv}`);

    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` };
    let body = { model: provider.model, max_tokens: provider.maxTokens, messages: [{ role: "user", content: prompt }] };

    if (provider.name.includes("Anthropic")) {
        headers["x-api-key"] = apiKey; 
        headers["anthropic-version"] = "2023-06-01"; 
        delete headers["Authorization"];
    }

    const response = await fetch(provider.url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);

    const data = await response.json();
    let content = provider.name.includes("Anthropic") ? data.content[0].text : data.choices[0].message.content;
    return content.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
}

/**
 * Main fix function with Context and Error Log
 */
async function fixCodeWithProviders(code, fileName, projectContext = "", errorLog = "", plan = "") {
    const MAX_SIZE_FOR_AI = 50000; 
    let contentToSend = code, isPreview = false;
    
    if (code.length > MAX_SIZE_FOR_AI) {
        contentToSend = code.substring(0, MAX_SIZE_FOR_AI) + "\n\n... [TRUNCATED] ..."; 
        isPreview = true;
    }

    // Use the Fixer Agent's prompt structure
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

module.exports = { fixCodeWithProviders, PROVIDERS };
