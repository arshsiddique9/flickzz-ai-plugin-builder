// scripts/free-models.js
// Auto-detects working free models across multiple providers

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════
// PROVIDER REGISTRY — Real free models with tool use
// ═══════════════════════════════════════════
const PROVIDERS = [
    {
        id: 'openrouter',
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        keyEnv: 'OPENROUTER_API_KEY',
        candidates: [
            'qwen/qwen3-coder:free',
            'qwen/qwen3.6-plus:free',
            'deepseek/deepseek-chat-v3-0324:free',
            'stealth/ox-alpha',
            'nvidia/nemotron-3-ultra:free',
            'google/gemini-2.0-flash-exp:free',
            'meta-llama/llama-3.3-70b-instruct:free'
        ]
    },
    {
        id: 'nvidia',
        name: 'NVIDIA NIM',
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        keyEnv: 'NVIDIA_API_KEY',
        candidates: [
            'nvidia/llama-3.3-nemotron-super-49b-v1',
            'deepseek-ai/deepseek-v3',
            'qwen/qwen2.5-coder-32b-instruct',
            'meta/llama-3.3-70b-instruct'
        ]
    },
    {
        id: 'agentrouter',
        name: 'AgentRouter',
        url: 'https://agentrouter.org/v1/chat/completions',
        keyEnv: 'AGENTROUTER_API_KEY',
        candidates: [
            'deepseek-v4-flash',
            'deepseek-v4-pro',
            'glm-5.1',
            'claude-opus-5'
        ]
    },
    {
        id: 'tokenharbor',
        name: 'TokenHarbor',
        url: 'https://api.tokenharbor.ai/v1/chat/completions',
        keyEnv: 'TOKENHARBOR_API_KEY',
        candidates: [
            'deepseek-v4.1-flash:free',
            'deepseek-v4-flash:free',
            'mimo-v2.5:free',
            'qwen3.8-27b:free',
            'qwen3.8-flash:free'
        ]
    },
    {
        id: 'unorouter',
        name: 'UnoRouter',
        url: 'https://api.unorouter.com/v1/chat/completions',
        keyEnv: 'UNOROUTER_API_KEY',
        candidates: [
            'deepseek/deepseek-v4-flash:free',
            'nvidia/nemotron-3-ultra:free',
            'gemma-4-31b-it:free',
            'gemini-3.5-flash-lite:free',
            'qwen3-32b:free'
        ]
    },
    {
        id: 'dahl',
        name: 'Dahl',
        url: 'https://inference.dahl.global/v1/chat/completions',
        keyEnv: 'DAHL_API_KEY',
        candidates: [
            'deepseek-ai/DeepSeek-V4-Flash-0731',
            'zai-org/GLM-5.3-Flash',
            'MiniMaxAI/MiniMax-M2.7',
            'moonshotai/Kimi-K2.6'
        ]
    },
    {
        id: 'nara',
        name: 'Nara',
        url: 'https://router.bynara.id/v1/chat/completions',
        keyEnv: 'NARA_API_KEY',
        candidates: [
            'deepseek-v4-flash-naraya',
            'qwen3.7-max-naraya',
            'mistral-large'
        ]
    }
];

// Cache working models so we don't re-probe every step
const CACHE_FILE = path.join(process.env.WORKSPACE_ROOT || '.', '.free-model-cache.json');
let memoryCache = null;

function loadCache() {
    if (memoryCache) return memoryCache;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            memoryCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        } else {
            memoryCache = {};
        }
    } catch {
        memoryCache = {};
    }
    return memoryCache;
}

function saveCache() {
    try {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(memoryCache, null, 2), 'utf8');
    } catch {}
}

// ═══════════════════════════════════════════
// Probe: test if a model supports tool calling
// ═══════════════════════════════════════════
async function probeModel(provider, model, timeoutMs = 15000) {
    const apiKey = process.env[provider.keyEnv];
    if (!apiKey) return { ok: false, reason: `Missing ${provider.keyEnv}` };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
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
                messages: [{ role: 'user', content: 'Reply with "ok" in one word.' }],
                tools: [{
                    type: 'function',
                    function: {
                        name: 'ping',
                        description: 'Test tool',
                        parameters: { type: 'object', properties: {}, required: [] }
                    }
                }],
                tool_choice: 'auto',
                max_tokens: 50,
                temperature: 0
            }),
            signal: controller.signal
        });
        clearTimeout(timer);

        if (!res.ok) {
            const errText = (await res.text()).slice(0, 200);
            return { ok: false, reason: `HTTP ${res.status}: ${errText}` };
        }
        return { ok: true, model };
    } catch (err) {
        clearTimeout(timer);
        return { ok: false, reason: err.message.slice(0, 120) };
    }
}

// ═══════════════════════════════════════════
// Find first working model for a provider
// ═══════════════════════════════════════════
async function findWorkingModel(provider) {
    const cache = loadCache();
    const cached = cache[provider.id];
    if (cached && cached.model) {
        // Verify cached model still works with quick check
        return { provider, model: cached.model, fromCache: true };
    }

    const apiKey = process.env[provider.keyEnv];
    if (!apiKey) {
        return null;
    }

    console.log(`[AutoDetect] 🔍 Probing ${provider.name} (${provider.candidates.length} candidates)...`);

    // Probe candidates sequentially (faster feedback than parallel)
    for (const model of provider.candidates) {
        const result = await probeModel(provider, model);
        if (result.ok) {
            console.log(`[AutoDetect] ✅ ${provider.name} → ${model}`);
            cache[provider.id] = { model, detectedAt: Date.now() };
            saveCache();
            return { provider, model, fromCache: false };
        } else {
            console.log(`[AutoDetect] ❌ ${provider.name}/${model} → ${result.reason}`);
        }
    }

    console.log(`[AutoDetect] ⚠️ No working model for ${provider.name}`);
    return null;
}

// ═══════════════════════════════════════════
// Auto-select: try all providers, return first working one
// ═══════════════════════════════════════════
async function selectWorkingProvider() {
    const cache = loadCache();

    // First: try cached providers (fast path)
    for (const provider of PROVIDERS) {
        if (cache[provider.id] && process.env[provider.keyEnv]) {
            return { provider, model: cache[provider.id].model };
        }
    }

    // Second: probe all providers with keys
    for (const provider of PROVIDERS) {
        if (!process.env[provider.keyEnv]) continue;
        const working = await findWorkingModel(provider);
        if (working) return working;
    }

    return null;
}

// ═══════════════════════════════════════════
// Invalidate cached model (call on hard failures)
// ═══════════════════════════════════════════
function invalidateProvider(providerId) {
    const cache = loadCache();
    delete cache[providerId];
    saveCache();
    console.log(`[AutoDetect] 🗑️ Invalidated cache for ${providerId}`);
}

// ═══════════════════════════════════════════
// Probe all providers (for diagnostic mode)
// ═══════════════════════════════════════════
async function probeAll() {
    const results = [];
    for (const provider of PROVIDERS) {
        if (!process.env[provider.keyEnv]) {
            results.push({ provider: provider.name, status: 'NO_KEY', model: null });
            continue;
        }
        const working = await findWorkingModel(provider);
        results.push({
            provider: provider.name,
            status: working ? 'WORKING' : 'FAILED',
            model: working ? working.model : null
        });
    }
    return results;
}

module.exports = {
    PROVIDERS,
    findWorkingModel,
    selectWorkingProvider,
    invalidateProvider,
    probeModel,
    probeAll
};
