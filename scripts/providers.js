// ============================================
// FlickZZ Provider Stack — Multi-Tier Fallback
// 8 Providers · Auto-Health · Auto-Fallback
// ============================================

// Environment keys
const KEYS = {
    dahl: process.env.DAHL_API_KEY,
    nara: process.env.NARA_API_KEY,
    openrouter: process.env.OPENROUTER_API_KEY,
    agentrouter: process.env.AGENTROUTER_API_KEY,
    unorouter: process.env.UNOROUTER_API_KEY,
    tokenharbor: process.env.TOKENHARBOR_API_KEY,
    nvidia: process.env.NVIDIA_API_KEY,
    openapis: 'admin', // Free beta
};

// ═══════════════════════════════════════════
// TIER 1: Premium Quality (Best for coding)
// ═══════════════════════════════════════════
const TIER_1 = [
    {
        name: 'OpenAPIs-Claude',
        url: 'https://api.openapis.online/anthropic/v1/chat/completions',
        key: KEYS.openapis,
        model: 'claude-opus-4.7',
        tier: 1,
        strength: 'coding',
        timeout: 90000
    },
    {
        name: 'OpenAPIs-GPT',
        url: 'https://api.openapis.online/openai/v1/chat/completions',
        key: KEYS.openapis,
        model: 'gpt-5.5',
        tier: 1,
        strength: 'reasoning',
        timeout: 90000
    },
    {
        name: 'AgentRouter-Claude',
        url: 'https://agentrouter.org/v1/chat/completions',
        key: KEYS.agentrouter,
        model: 'claude-opus-4-8',
        tier: 1,
        strength: 'coding',
        extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' },
        timeout: 90000
    },
    {
        name: 'AgentRouter-GPT6',
        url: 'https://agentrouter.org/v1/chat/completions',
        key: KEYS.agentrouter,
        model: 'gpt-6-astra',
        tier: 1,
        strength: 'reasoning',
        extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' },
        timeout: 90000
    }
];

// ═══════════════════════════════════════════
// TIER 2: Fast & Reliable (Best for planning)
// ═══════════════════════════════════════════
const TIER_2 = [
    {
        name: 'NVIDIA-DeepSeek',
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        key: KEYS.nvidia,
        model: 'deepseek-ai/deepseek-r1',
        tier: 2,
        strength: 'coding',
        timeout: 90000
    },
    {
        name: 'NVIDIA-Qwen',
        url: 'https://integrate.api.nvidia.com/v1/chat/completions',
        key: KEYS.nvidia,
        model: 'qwen/qwen2.5-coder-32b-instruct',
        tier: 2,
        strength: 'coding',
        timeout: 90000
    },
    {
        name: 'Dahl-MiniMax',
        url: 'https://inference.dahl.global/v1/chat/completions',
        key: KEYS.dahl,
        model: 'MiniMaxAI/MiniMax-M2.7',
        tier: 2,
        strength: 'balanced',
        timeout: 90000
    },
    {
        name: 'Dahl-DeepSeek',
        url: 'https://inference.dahl.global/v1/chat/completions',
        key: KEYS.dahl,
        model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
        tier: 2,
        strength: 'coding',
        timeout: 90000
    },
    {
        name: 'Nara-Super',
        url: 'https://router.bynara.id/v1/chat/completions',
        key: KEYS.nara,
        model: 'nemotron-3-super-free',
        tier: 2,
        strength: 'balanced',
        timeout: 90000
    }
];

// ═══════════════════════════════════════════
// TIER 3: Fallback (When others fail)
// ═══════════════════════════════════════════
const TIER_3 = [
    {
        name: 'Nara-Ultra',
        url: 'https://router.bynara.id/v1/chat/completions',
        key: KEYS.nara,
        model: 'nemotron-3-ultra-free',
        tier: 3,
        strength: 'balanced',
        timeout: 90000
    },
    {
        name: 'OpenRouter-Qwen',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: KEYS.openrouter,
        model: 'qwen/qwen3-coder:free',
        tier: 3,
        strength: 'coding',
        extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' },
        timeout: 90000
    },
    {
        name: 'OpenRouter-Nemotron',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: KEYS.openrouter,
        model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        tier: 3,
        strength: 'balanced',
        extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ' },
        timeout: 90000
    },
    {
        name: 'UNOROUTER',
        url: 'https://api.unorouter.com/v1/chat/completions',
        key: KEYS.unorouter,
        model: 'nemotron-3-ultra-550b-a55b:free',
        tier: 3,
        strength: 'balanced',
        timeout: 90000
    },
    {
        name: 'TokenHarbor',
        url: 'https://api.tokenharbor.ai/v1/chat/completions',
        key: KEYS.tokenharbor,
        model: 'deepseek-v4.1-flash:free',
        tier: 3,
        strength: 'coding',
        timeout: 90000
    }
];

// ═══════════════════════════════════════════
// HEALTH TRACKING (in-memory for this run)
// ═══════════════════════════════════════════
const health = {};

function recordSuccess(name) {
    if (!health[name]) health[name] = { fail: 0, success: 0 };
    health[name].success++;
    health[name].fail = Math.max(0, health[name].fail - 1);
}

function recordFailure(name) {
    if (!health[name]) health[name] = { fail: 0, success: 0 };
    health[name].fail++;
}

function isHealthy(name) {
    const h = health[name];
    if (!h) return true;
    return (h.success - h.fail) > -3;
}

// ═══════════════════════════════════════════
// GET PROVIDERS BY TIER
// ═══════════════════════════════════════════
function getProviders(options = {}) {
    const { tier, strength, priority } = options;

    let all = [...TIER_1, ...TIER_2, ...TIER_3];

    // Filter by tier if specified
    if (tier) all = all.filter(p => p.tier === tier);

    // Filter by strength if specified
    if (strength) all = all.filter(p => p.strength === strength);

    // Filter out keys that are missing
    all = all.filter(p => p.key);

    // Sort: healthy first, then by tier
    all.sort((a, b) => {
        const aH = isHealthy(a.name) ? 1 : 0;
        const bH = isHealthy(b.name) ? 1 : 0;
        if (aH !== bH) return bH - aH;
        return a.tier - b.tier;
    });

    return all;
}

// ═══════════════════════════════════════════
// COUNT PROVIDERS
// ═══════════════════════════════════════════
function getProviderStats() {
    return {
        total: TIER_1.length + TIER_2.length + TIER_3.length,
        tier1: TIER_1.filter(p => p.key).length,
        tier2: TIER_2.filter(p => p.key).length,
        tier3: TIER_3.filter(p => p.key).length,
        activeKeys: Object.values(KEYS).filter(k => k && k !== 'admin').length
    };
}

module.exports = {
    getProviders,
    getProviderStats,
    recordSuccess,
    recordFailure,
    isHealthy,
    KEYS
};
