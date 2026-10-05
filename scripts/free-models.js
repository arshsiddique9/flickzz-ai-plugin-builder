// scripts/free-models.js
// Auto-detects working free models across multiple providers

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════
// PROVIDER REGISTRY — Real free models with tool use
// ═══════════════════════════════════════════
const PROVIDERS = [
    {
        id: 'agentrouter',
        name: 'AgentRouter',
        url: 'https://agentrouter.org/v1/chat/completions',
        keyEnv: 'AGENTROUTER_API_KEY',
        candidates: ['deepseek-v4-flash', 'deepseek-v4-pro', 'glm-5.1', 'claude-opus-5']
    },
    {
        id: 'unorouter',
        name: 'UnoRouter',
        url: 'https://api.unorouter.com/v1/chat/completions',
        keyEnv: 'UNOROUTER_API_KEY',
        candidates: ['gemini-3.5-flash-lite:free', 'deepseek/deepseek-v4-flash:free', 'qwen3-32b:free']
    },
    {
        id: 'dahl',
        name: 'Dahl',
        url: 'https://inference.dahl.global/v1/chat/completions',
        keyEnv: 'DAHL_API_KEY',
        candidates: ['MiniMaxAI/MiniMax-M2.7', 'moonshotai/Kimi-K2.6', 'zai-org/GLM-5.3-Flash']
    },
    {
        id: 'openrouter',
        name: 'OpenRouter',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        keyEnv: 'OPENROUTER_API_KEY',
        candidates: ['qwen/qwen3-coder:free', 'deepseek/deepseek-chat-v3-0324:free']
    },
    {
        id: 'tokenharbor',
        name: 'TokenHarbor',
        url: 'https://api.tokenharbor.ai/v1/chat/completions',
        keyEnv: 'TOKENHARBOR_API_KEY',
        candidates: ['deepseek-v4.1-flash:free', 'qwen3.8-flash:free']
    },
    {
        id: 'nvidia',
        name: 'NVIDIA NIM',
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        keyEnv: 'NVIDIA_API_KEY',
        candidates: ['nvidia/llama-3.3-nemotron-super-49b-v1', 'meta/llama-3.3-70b-instruct']
    },
    {
        id: 'nara',
        name: 'Nara',
        url: 'https://router.bynara.id/v1/chat/completions',
        keyEnv: 'NARA_API_KEY',
        candidates: ['deepseek-v4-flash-naraya', 'mistral-large']
    }
];

// Cache file location
const CACHE_FILE = path.join(process.env.WORKSPACE_ROOT || '.', '.free-model-cache.json');
const CACHE_TTL_MS = 30 * 60 * 1000; // 🆕 30 min TTL — stale cache avoided
let memoryCache = null;

function loadCache() {
    if (memoryCache) return memoryCache;
    try {
        if (fs.existsSync(CACHE_FILE)) {
            const raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
            // 🆕 Purge expired entries
            const now = Date.now();
            for (const key of Object.keys(raw)) {
                if (!raw[key].detectedAt || (now - raw[key].detectedAt) > CACHE_TTL_MS) {
                    delete raw[key];
                }
            }
            memoryCache = raw;
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
// 🆕 Detect HTML/garbage response (broken endpoint)
// ═══════════════════════════════════════════
function looksLikeHtml(text) {
    if (!text) return false;
    const t = text.trim().slice(0, 100).toLowerCase();
    return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml');
}

// ═══════════════════════════════════════════
// Probe: test if a model supports tool calling
// 🆕 Timeout: 25s (was 15s — bigger models need more time)
// ═══════════════════════════════════════════
async function probeModel(provider, model, timeoutMs = 25000) {
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

        // 🆕 Verify it's actually JSON (not HTML redirect)
        const rawText = await res.text();
        if (looksLikeHtml(rawText)) {
            return { ok: false, reason: `HTML response (endpoint broken)` };
        }

        try {
            const data = JSON.parse(rawText);
            if (!data.choices || !data.choices[0]) {
                return { ok: false, reason: `No choices in response` };
            }
        } catch (e) {
            return { ok: false, reason: `Invalid JSON: ${rawText.slice(0, 100)}` };
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
        return { provider, model: cached.model, fromCache: true };
    }

    if (!process.env[provider.keyEnv]) return null;

    console.log(`[AutoDetect] 🔍 Probing ${provider.name} (${provider.candidates.length} candidates)...`);

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

async function selectWorkingProvider() {
    const cache = loadCache();
    for (const provider of PROVIDERS) {
        if (cache[provider.id] && process.env[provider.keyEnv]) {
            return { provider, model: cache[provider.id].model };
        }
    }
    for (const provider of PROVIDERS) {
        if (!process.env[provider.keyEnv]) continue;
        const working = await findWorkingModel(provider);
        if (working) return working;
    }
    return null;
}

function invalidateProvider(providerId) {
    const cache = loadCache();
    delete cache[providerId];
    saveCache();
    console.log(`[AutoDetect] 🗑️ Invalidated cache for ${providerId}`);
}

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
