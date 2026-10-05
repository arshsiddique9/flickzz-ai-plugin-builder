// ============================================
// FlickZZ Token Tracker
// Tracks token usage for the UI dashboard
// ============================================

const fs = require('fs');
const path = require('path');

const TRACKER_FILE = path.join(process.cwd(), 'token-usage.json');

// ═══════════════════════════════════════════
// LOAD / SAVE
// ═══════════════════════════════════════════
function loadTracker() {
    if (!fs.existsSync(TRACKER_FILE)) {
        return {
            totalTokens: 0,
            totalCalls: 0,
            byProvider: {},
            byModel: {},
            lastUpdated: null
        };
    }
    try {
        return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf-8'));
    } catch {
        return { totalTokens: 0, totalCalls: 0, byProvider: {}, byModel: {}, lastUpdated: null };
    }
}

function saveTracker(tracker) {
    tracker.lastUpdated = new Date().toISOString();
    fs.writeFileSync(TRACKER_FILE, JSON.stringify(tracker, null, 2));
}

// ═══════════════════════════════════════════
// TRACK A CALL
// ═══════════════════════════════════════════
function trackCall(providerName, modelName, promptTokens = 0, completionTokens = 0) {
    const tracker = loadTracker();
    const totalTokens = promptTokens + completionTokens;

    tracker.totalTokens += totalTokens;
    tracker.totalCalls += 1;

    if (!tracker.byProvider[providerName]) {
        tracker.byProvider[providerName] = { tokens: 0, calls: 0 };
    }
    tracker.byProvider[providerName].tokens += totalTokens;
    tracker.byProvider[providerName].calls += 1;

    if (!tracker.byModel[modelName]) {
        tracker.byModel[modelName] = { tokens: 0, calls: 0 };
    }
    tracker.byModel[modelName].tokens += totalTokens;
    tracker.byModel[modelName].calls += 1;

    saveTracker(tracker);
    return tracker;
}

// ═══════════════════════════════════════════
// GET SUMMARY (for UI)
// ═══════════════════════════════════════════
function getSummary() {
    const tracker = loadTracker();
    return {
        totalTokens: tracker.totalTokens,
        totalCalls: tracker.totalCalls,
        formattedTokens: formatNumber(tracker.totalTokens),
        topProvider: getTopProvider(tracker),
        topModel: getTopModel(tracker),
        lastUpdated: tracker.lastUpdated
    };
}

function getTopProvider(tracker) {
    let top = null;
    let max = 0;
    for (const [name, data] of Object.entries(tracker.byProvider)) {
        if (data.tokens > max) {
            max = data.tokens;
            top = { name, ...data };
        }
    }
    return top;
}

function getTopModel(tracker) {
    let top = null;
    let max = 0;
    for (const [name, data] of Object.entries(tracker.byModel)) {
        if (data.tokens > max) {
            max = data.tokens;
            top = { name, ...data };
        }
    }
    return top;
}

// ═══════════════════════════════════════════
// FORMAT NUMBER (24.5M, 1.2K, etc.)
// ═══════════════════════════════════════════
function formatNumber(n) {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(1) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return String(n);
}

module.exports = {
    trackCall,
    getSummary,
    loadTracker,
    saveTracker
};
