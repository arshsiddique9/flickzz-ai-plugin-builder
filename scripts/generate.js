// ============================================
// FlickZZ Builder — Multi-Pass Generation Engine (v5.2)
// FIXED: Added UNOROUTER & Token Harbor providers
// ============================================

const fs = require('fs');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const AGENTROUTER_API_KEY = process.env.AGENTROUTER_API_KEY;
const UNOROUTER_API_KEY = process.env.UNOROUTER_API_KEY; // ✅ NEW
const TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_API_KEY; // ✅ NEW
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JOB_ID = process.env.JOB_ID;
const PROMPT_B64 = process.env.PROMPT_B64;
const IS_CHAT = process.env.IS_CHAT === 'true';

const USER_PROMPT = Buffer.from(PROMPT_B64 || '', 'base64').toString('utf-8');

// ═══════════════════════════════════════════
// MODEL HEALTH TRACKING
// ═══════════════════════════════════════════
const modelHealth = {};

function getModelKey(provider, model) {
    return `${provider}:${model}`;
}

function trackSuccess(provider, model) {
    const key = getModelKey(provider, model);
    if (!modelHealth[key]) modelHealth[key] = { fail: 0, success: 0 };
    modelHealth[key].success++;
    modelHealth[key].fail = Math.max(0, modelHealth[key].fail - 1);
}

function trackFailure(provider, model) {
    const key = getModelKey(provider, model);
    if (!modelHealth[key]) modelHealth[key] = { fail: 0, success: 0 };
    modelHealth[key].fail++;
}

function isModelHealthy(provider, model) {
    const key = getModelKey(provider, model);
    const h = modelHealth[key];
    if (!h) return true;
    return (h.success - h.fail) > -3;
}

console.log(`Prompt: ${USER_PROMPT.length} chars`);
console.log(`Is chat: ${IS_CHAT}`);
console.log(`Job ID: ${JOB_ID}`);

// ═══════════════════════════════════════════
// SUPABASE — Progress Updates
// ═══════════════════════════════════════════
async function updateProgress(updates) {
    const body = {
        progress: {
            ...updates,
            lastUpdate: new Date().toISOString()
        }
    };

    try {
        await fetch(`${SUPABASE_URL}/rest/v1/ai_jobs?id=eq.${JOB_ID}`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
                'apikey': SUPABASE_SERVICE_KEY,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
            },
            body: JSON.stringify(body)
        });
        console.log(`Progress [${updates.stage || '?'}] step ${updates.currentStep || 0}/${updates.totalSteps || 0}${updates.pass ? ` pass ${updates.pass}` : ''}`);
    } catch (err) {
        console.error('Progress update failed:', err.message);
    }
}

// ═══════════════════════════════════════════
// CONTENT VALIDATION
// ═══════════════════════════════════════════
function isValidContent(content) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length === 0) return false;

    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
        return false;
    }

    if (trimmed.startsWith('{') && /"(error|errors|message)".*"(rate|limit|unavailable|forbidden|not found|model_)/i.test(trimmed.substring(0, 300))) {
        return false;
    }

    if (trimmed.length < 20) return false;

    return true;
}

// ═══════════════════════════════════════════
// AI PROVIDER — with health-aware routing
// ═══════════════════════════════════════════
async function callAI(systemPrompt, userPrompt, maxTokens = 4000, retries = 2) {
    const providers = [
        {
            name: 'Dahl',
            url: 'https://inference.dahl.global/v1/chat/completions',
            key: DAHL_API_KEY,
            models: ['MiniMaxAI/MiniMax-M2.7', 'deepseek-ai/DeepSeek-V4-Flash-0731']
        },
        {
            name: 'Nara',
            url: 'https://router.bynara.id/v1/chat/completions',
            key: NARA_API_KEY,
            models: ['nemotron-3-super-free', 'laguna-s-2.1', 'nemotron-3-ultra-free']
        },
        {
            name: 'OpenRouter',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            key: OPENROUTER_API_KEY,
            models: ['qwen/qwen3-coder:free', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-oss-120b:free'],
            extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' }
        },
        {
            name: 'AgentRouter',
            url: 'https://agentrouter.org/v1/chat/completions',
            key: AGENTROUTER_API_KEY,
            models: ['gpt-6-astra', 'claude-opus-4-8', 'deepseek-v4-flash'],
            extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' }
        },
        // ✅ NEW: UNOROUTER Provider
        {
            name: 'UNOROUTER',
            url: 'https://api.unorouter.com/v1/chat/completions',
            key: UNOROUTER_API_KEY,
            models: ['gemini-3.5-flash-lite:free', 'nemotron-3-ultra-550b-a55b:free', 'deepseek-v4-flash:free']
        },
        // ✅ NEW: Token Harbor Provider
        {
            name: 'TokenHarbor',
            url: 'https://api.tokenharbor.ai/v1/chat/completions',
            key: TOKENHARBOR_API_KEY,
            models: ['qwen3.8-flash:free', 'deepseek-v4.1-flash:free', 'mimo-v2.6-flash:free']
        }
    ];

    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
            console.log(`  Retry attempt ${attempt}/${retries}...`);
            await new Promise(r => setTimeout(r, 2000));
        }

        for (const provider of providers) {
            if (!provider.key) continue;

            for (const model of provider.models) {
                if (attempt > 0 && !isModelHealthy(provider.name, model)) {
                    console.log(`  [${provider.name}] ${model} — SKIPPED (unhealthy)`);
                    continue;
                }

                try {
                    console.log(`[${provider.name}] ${model} (max ${maxTokens} tokens)`);

                    const headers = {
                        'Authorization': `Bearer ${provider.key}`,
                        'Content-Type': 'application/json',
                        ...(provider.extra || {})
                    };

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 90000);

                    const res = await fetch(provider.url, {
                        method: 'POST',
                        headers,
                        signal: controller.signal,
                        body: JSON.stringify({
                            model,
                            messages: [
                                { role: 'system', content: systemPrompt },
                                { role: 'user', content: userPrompt }
                            ],
                            temperature: 0.2,
                            max_tokens: maxTokens,
                            top_p: 0.9
                        })
                    });
                    clearTimeout(timeoutId);

                    if (!res.ok) {
                        const errText = await res.text();
                        console.log(`  ${res.status}: ${errText.substring(0, 80)}`);
                        trackFailure(provider.name, model);
                        continue;
                    }

                    const contentType = res.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) {
                        console.log(`  Invalid content-type: ${contentType}`);
                        trackFailure(provider.name, model);
                        continue;
                    }

                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

                    if (!isValidContent(content)) {
                        console.log(`  Invalid/empty response (${content.length} chars), trying next...`);
                        trackFailure(provider.name, model);
                        continue;
                    }

                    if (finishReason === 'length' && attempt < retries) {
                        console.log(`  Hit token limit, will retry...`);
                        trackFailure(provider.name, model);
                        break;
                    }

                    console.log(`  ${content.length} chars (${finishReason})`);
                    trackSuccess(provider.name, model);
                    return { ok: true, content, finishReason, provider: provider.name, model };
                } catch (err) {
                    console.log(`  ${err.message}`);
                    trackFailure(provider.name, model);
                }
            }
        }
    }

    return { ok: false, error: 'All providers failed' };
}

// ═══════════════════════════════════════════
// ROBUST JSON EXTRACTOR
// ═══════════════════════════════════════════
function extractJSON(text) {
    if (!text) return null;

    let json = text.trim();
    json = json.replace(/^\uFEFF/, '');
    json = json.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
    json = json.replace(/<think>[\s\S]*?<\/think>/gi, '');
    json = json.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    const startIdx = json.indexOf('{');
    const endIdx = json.lastIndexOf('}');

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        return null;
    }

    json = json.substring(startIdx, endIdx + 1);

    try {
        return JSON.parse(json);
    } catch (err) {
        console.log(`  JSON parse failed: ${err.message}`);

        json = json
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/\/\/[^\n]*/g, '')
            .replace(/\/\*[\s\S]*?\*\//g, '');

        try {
            return JSON.parse(json);
        } catch (retryErr) {
            console.log(`  JSON parse failed after cleanup: ${retryErr.message}`);
            return null;
        }
    }
}

// ═══════════════════════════════════════════
// FALLBACK PLAN
// ═══════════════════════════════════════════
function getFallbackPlan(pluginName = 'GeneratedPlugin') {
    const pkg = 'com.flickzz.generated';
    return {
        pluginName: pluginName,
        description: 'Auto-generated plugin',
        complexity: 'medium',
        files: [
            { path: 'pom.xml', purpose: 'Maven build file' },
            { path: 'src/main/resources/plugin.yml', purpose: 'Plugin manifest' },
            { path: 'src/main/resources/config.yml', purpose: 'Plugin configuration' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/${pluginName}.java`, purpose: 'Main plugin class' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/commands/HomeCommand.java`, purpose: 'Command handler' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/managers/HomeManager.java`, purpose: 'Data manager' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/listeners/PlayerListener.java`, purpose: 'Event listener' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/utils/MessageUtil.java`, purpose: 'Message utility' },
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/utils/ConfigUtil.java`, purpose: 'Config utility' }
        ]
    };
}

// ═══════════════════════════════════════════
// PLANNING PHASE
// ═══════════════════════════════════════════
async function planPlugin(userPrompt) {
    console.log('\nPLANNING PHASE');
    const planStartTime = Date.now();

    await updateProgress({
        stage: 'planning',
        currentStep: 0,
        totalSteps: 1,
        files: [],
        currentFile: 'Analyzing your plugin request'
    });

    const systemPrompt = `You are a Minecraft plugin architect. Output ONLY a valid JSON plan.

🚨 CRITICAL OUTPUT RULES:
- Output ONLY the JSON object. Nothing else.
- Start with { and end with }.
- NO markdown. NO \`\`\`. NO explanation. NO commentary.
- NO thinking tags.
- Make sure JSON is valid (no trailing commas, proper quotes).

OUTPUT FORMAT:
{"pluginName":"FlickZZHomes","description":"Short description","complexity":"simple|medium|complex|framework","files":[{"path":"pom.xml","purpose":"Maven build file"},{"path":"src/main/resources/plugin.yml","purpose":"Plugin manifest"},{"path":"src/main/resources/config.yml","purpose":"Config"},{"path":"src/main/java/com/flickzz/generated/FlickZZHomes.java","purpose":"Main class"}]}

FILE COUNT RULES:
- Simple (1-2 commands): 4-5 files
- Medium (3-5 commands): 6-9 files
- Complex (GUI, admin, events): 10-18 files
- Framework (multi-system): 18-35 files

REQUIRED FILES:
1. pom.xml
2. src/main/resources/plugin.yml
3. src/main/resources/config.yml
4. Main class — FIRST Java file

STANDARDS:
- Paper API 1.21.1, Java 21
- Package: com.flickzz.generated

Output ONLY the JSON object now.`;

    const result = await callAI(systemPrompt, userPrompt, 5000);

    if (!result.ok) {
        console.log('  All providers failed for planning, using fallback plan');
        return getFallbackPlan();
    }

    const plan = extractJSON(result.content);

    if (!plan || !plan.files || !Array.isArray(plan.files) || plan.files.length === 0) {
        console.log('  Invalid plan from AI, using fallback plan');
        return getFallbackPlan();
    }

    if (!plan.pluginName) plan.pluginName = 'GeneratedPlugin';
    plan.pluginName = plan.pluginName.replace(/[^a-zA-Z0-9]/g, '');

    const planDuration = Date.now() - planStartTime;
    console.log(`Planned ${plan.files.length} files [${plan.complexity || 'unknown'}] in ${(planDuration / 1000).toFixed(1)}s`);
    plan.files.forEach((f, i) => console.log(`  ${i + 1}. ${f.path}`));
    return plan;
}

// ═══════════════════════════════════════════
// SMART CONTEXT
// ═══════════════════════════════════════════
function buildContext(file, alreadyGenerated, plan) {
    if (!alreadyGenerated || alreadyGenerated.length === 0) return '';

    if (file.path.endsWith('.xml') || file.path.endsWith('.yml') || file.path.endsWith('.yaml')) {
        return '\n\n(No context files needed - resource file)';
    }

    const isMainClass = file.path.endsWith(`/${plan.pluginName}.java`);
    if (isMainClass) {
        return '\n\n(No context needed - main entry point)';
    }

    const relevantFiles = alreadyGenerated.filter((f) => {
        const filePath = (typeof f === 'string') ? f : (f && f.path ? f.path : '');
        if (!filePath) return false;

        if (filePath.endsWith(`/${plan.pluginName}.java`)) return true;

        const idx = alreadyGenerated.indexOf(f);
        return idx >= alreadyGenerated.length - 2;
    });

    if (relevantFiles.length === 0) return '';

    const contextStr = relevantFiles.map((f) => {
        if (typeof f === 'string') {
            return `### (content)\n${f}`;
        }
        const filePath = f.path || 'unknown';
        const fileContent = f.content || '';
        return `### ${filePath}\n${fileContent}`;
    }).join('\n\n');

    return `\n\n═══ RELEVANT CONTEXT ═══\n${contextStr}\n════════════════════════`;
}

// ═══════════════════════════════════════════
// GENERATE ONE FILE
// ═══════════════════════════════════════════
async function generateFile(file, plan, alreadyGenerated) {
    console.log(`\nGenerating: ${file.path}`);

    const filesContext = buildContext(file, alreadyGenerated, plan);
    const isResource = file.path.endsWith('.xml') || file.path.endsWith('.yml') || file.path.endsWith('.yaml');

    const systemPrompt = `You are an expert Java Bukkit/Paper plugin developer. Generate ONE complete file.

FILE INFO:
- Plugin: ${plan.pluginName}
- Path: ${file.path}
- Purpose: ${file.purpose}
- Package: com.flickzz.generated
- Paper API: 1.21.1, Java 21
- Type: ${isResource ? 'Resource' : 'Java Class'}
${filesContext}

CRITICAL RULES:
1. Output ONLY the raw file content. NO markdown, NO \`\`\`, NO explanation.
2. Use LITERAL < and > characters (never escape)
3. Include ALL imports at the top (Java files)
4. Package: com.flickzz.generated
5. Import EVERY class you reference
6. pom.xml → Paper API 1.21.1-R0.1-SNAPSHOT, Java 21, maven-compiler-plugin 3.13.0
7. plugin.yml → api-version: '1.21', all commands + permissions
8. config.yml → all messages with & color codes
9. Verify methods exist in Bukkit/Paper API
10. Add null checks, instanceof checks, try-catch

COMMON MISTAKES (AVOID):
- Missing imports
- inventory.getTitle() → event.getView().getTitle()
- (Player) sender without instanceof
- File.createNewFile() without try-catch
- Sound.valueOf() / Particle.valueOf() without try-catch
- Private methods called from another class
- Bukkit.getWorld() without null check
- getCommand("x") without null check

Output ONLY the file content. Start immediately.`;

    const result = await callAI(systemPrompt, `Generate the complete file: ${file.path}`, 6000);
    if (!result.ok) throw new Error(`Failed to generate ${file.path}`);

    let content = result.content.trim();
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    content = content.replace(/^\/\/\s*(File:|Path:|Here is|This is).*\n/i, '');
    content = content.replace(/^(Here is|This is|Sure|Okay|Alright)[^\n]*\n+/i, '');

    if (!isResource) {
        const lastBrace = content.lastIndexOf('}');
        if (lastBrace > 0 && lastBrace < content.length - 50) {
            content = content.substring(0, lastBrace + 1);
        }
    }

    if (content.length < 30) {
        throw new Error(`Generated content too short: ${content.length} chars`);
    }

    console.log(`  Generated ${content.length} chars`);
    return content;
}

// ═══════════════════════════════════════════
// CHAT MODE
// ═══════════════════════════════════════════
async function handleChat(userPrompt) {
    console.log('\nCHAT MODE');

    const systemPrompt = `You are FlickZZ Builder AI — the official AI assistant of FlickZZ Resources, created by Arsh Siddique.

IDENTITY:
- Name: FlickZZ Builder AI
- Creator: Arsh Siddique (FlickZZ Resources)
- NEVER mention: OpenAI, Anthropic, Claude, GPT, Gemini, or any real AI company

BEHAVIOR:
- Reply in user's language (Hindi/Hinglish/English)
- Keep responses short (under 100 words)
- NO thinking tags, NO internal monologue
- Reply directly`;

    const result = await callAI(systemPrompt, userPrompt, 1500);
    if (!result.ok) throw new Error('Chat failed');

    let response = result.content;
    response = response.replace(/<think>[\s\S]*?<\/think>/gi, '');
    response = response.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    response = response.replace(/<\/?think>/gi, '').trim();

    return response;
}

// ═══════════════════════════════════════════
// PLAN VALIDATION
// ═══════════════════════════════════════════
function validatePlan(plan) {
    const paths = plan.files.map(f => f.path.toLowerCase());
    const pkg = 'com.flickzz.generated';

    const hasPom = paths.some(p => p.includes('pom.xml'));
    const hasPluginYml = paths.some(p => p.includes('plugin.yml'));
    const hasConfigYml = paths.some(p => p.includes('config.yml'));
    const hasMainClass = paths.some(p => p.endsWith(`${plan.pluginName.toLowerCase()}.java`));

    if (!hasPom) plan.files.unshift({ path: 'pom.xml', purpose: 'Maven build file' });
    if (!hasPluginYml) {
        const idx = plan.files.findIndex(f => f.path.includes('pom.xml'));
        plan.files.splice(idx + 1, 0, { path: 'src/main/resources/plugin.yml', purpose: 'Plugin manifest' });
    }
    if (!hasConfigYml) {
        const idx = plan.files.findIndex(f => f.path.includes('plugin.yml'));
        plan.files.splice(idx + 1, 0, { path: 'src/main/resources/config.yml', purpose: 'Configuration' });
    }
    if (!hasMainClass) {
        const idx = plan.files.findIndex(f => f.path.includes('config.yml'));
        plan.files.splice(idx + 1, 0, {
            path: `src/main/java/${pkg.replace(/\./g, '/')}/${plan.pluginName}.java`,
            purpose: 'Main plugin class'
        });
    }

    return plan;
}

// ═══════════════════════════════════════════
// HELPER: Update file status
// ═══════════════════════════════════════════
function setFileStatus(fileList, filePath, status, options = {}) {
    const file = fileList.find(f => f.path === filePath);
    if (!file) return fileList;

    file.status = status;

    if (options.size !== undefined) file.size = options.size;
    if (options.startedAt !== undefined) file.startedAt = options.startedAt;
    if (options.duration !== undefined) file.duration = options.duration;
    if (options.model !== undefined) file.model = options.model;

    return fileList;
}

// ═══════════════════════════════════════════
// MAIN FLOW — Multi-Pass Generation
// ═══════════════════════════════════════════
async function main() {
    try {
        if (IS_CHAT) {
            await updateProgress({ stage: 'chatting', currentStep: 1, totalSteps: 1 });
            const response = await handleChat(USER_PROMPT);
            fs.writeFileSync('ai-result.txt', response, 'utf-8');
            await updateProgress({ stage: 'completed', currentStep: 1, totalSteps: 1 });
            console.log('Chat response saved');
            return;
        }

        console.log('\n═══ BUILD MODE ═══');
        const jobStartTime = Date.now();

        let plan = await planPlugin(USER_PROMPT);
        plan = validatePlan(plan);

        const fileList = plan.files.map(f => ({
            path: f.path,
            name: f.path.split('/').pop(),
            status: 'pending',
            size: 0,
            attempts: 0,
            lastPass: 0,
            startedAt: null,
            duration: null,
            model: null
        }));

        const generatedMap = new Map();

        await updateProgress({
            stage: 'planned',
            currentStep: 0,
            totalSteps: plan.files.length,
            pluginName: plan.pluginName,
            complexity: plan.complexity,
            files: fileList,
            currentFile: null,
            pass: 1
        });

        const MAX_FILE_RETRIES = 2;
        const MAX_PASSES = 3;

        for (let pass = 1; pass <= MAX_PASSES; pass++) {
            const filesToDo = fileList.filter(f => f.status === 'pending' || f.status === 'skipped');

            if (filesToDo.length === 0) {
                console.log(`\nAll files complete after pass ${pass - 1}`);
                break;
            }

            console.log(`\n═══ PASS ${pass}/${MAX_PASSES} ═══`);
            console.log(`${filesToDo.length} files remaining`);

            for (let i = 0; i < fileList.length; i++) {
                const fileEntry = fileList[i];

                if (fileEntry.status === 'completed') continue;
                if (fileEntry.status === 'failed') continue;

                const fileDef = plan.files.find(f => f.path === fileEntry.path);
                if (!fileDef) continue;

                const fileStartTime = Date.now();
                fileEntry.startedAt = fileStartTime;
                fileEntry.attempts = (fileEntry.attempts || 0) + 1;
                fileEntry.lastPass = pass;

                setFileStatus(fileList, fileEntry.path, 'generating', {
                    startedAt: fileStartTime
                });

                await updateProgress({
                    stage: 'generating',
                    currentStep: i + 1,
                    totalSteps: plan.files.length,
                    files: fileList,
                    currentFile: fileEntry.path,
                    pass: pass,
                    message: pass > 1 ? `Retry pass ${pass}` : null
                });

                let success = false;
                let lastError = null;

                for (let attempt = 0; attempt <= MAX_FILE_RETRIES && !success; attempt++) {
                    try {
                        if (attempt > 0) {
                            console.log(`  Retry ${attempt}/${MAX_FILE_RETRIES} for ${fileEntry.path}`);
                            await new Promise(r => setTimeout(r, 3000));
                        }

                        const contextFiles = Array.from(generatedMap.values());
                        const content = await generateFile(fileDef, plan, contextFiles);

                        generatedMap.set(fileEntry.path, {
                            path: fileEntry.path,
                            content: content
                        });

                        success = true;

                        const duration = Date.now() - fileStartTime;
                        fileEntry.duration = duration;
                        fileEntry.size = content.length;

                        setFileStatus(fileList, fileEntry.path, 'completed', {
                            size: content.length,
                            duration: duration
                        });

                        console.log(`  ✅ Completed in ${(duration / 1000).toFixed(1)}s`);

                        await updateProgress({
                            stage: 'generating',
                            currentStep: i + 1,
                            totalSteps: plan.files.length,
                            files: fileList,
                            currentFile: null,
                            pass: pass
                        });
                    } catch (err) {
                        lastError = err;
                        console.error(`  Attempt ${attempt + 1} failed:`, err.message);
                    }
                }

                if (!success) {
                    const duration = Date.now() - fileStartTime;

                    if (pass >= MAX_PASSES) {
                        setFileStatus(fileList, fileEntry.path, 'failed', {
                            duration: duration
                        });

                        await updateProgress({
                            stage: 'generating',
                            currentStep: i + 1,
                            totalSteps: plan.files.length,
                            files: fileList,
                            currentFile: null,
                            pass: pass,
                            message: `Failed permanently: ${fileEntry.name}`
                        });

                        console.warn(`File ${fileEntry.path} FAILED permanently (all passes exhausted)`);
                    } else {
                        setFileStatus(fileList, fileEntry.path, 'skipped', {
                            duration: duration
                        });

                        await updateProgress({
                            stage: 'generating',
                            currentStep: i + 1,
                            totalSteps: plan.files.length,
                            files: fileList,
                            currentFile: null,
                            pass: pass,
                            message: `Skipped ${fileEntry.name} — will retry in pass ${pass + 1}`
                        });

                        console.warn(`File ${fileEntry.path} SKIPPED — will retry in pass ${pass + 1}`);
                    }

                    await new Promise(r => setTimeout(r, 2000));
                }
            }
        }

        const failedFiles = fileList.filter(f => f.status === 'failed');
        const skippedFiles = fileList.filter(f => f.status === 'skipped');
        const completedFiles = fileList.filter(f => f.status === 'completed');
        const jobDuration = Date.now() - jobStartTime;

        console.log(`\n═══ RESULTS ═══`);
        console.log(`Completed: ${completedFiles.length}/${fileList.length}`);
        console.log(`Skipped: ${skippedFiles.length}`);
        console.log(`Failed: ${failedFiles.length}`);
        console.log(`Total time: ${(jobDuration / 1000).toFixed(1)}s`);

        await updateProgress({
            stage: 'finalizing',
            currentStep: plan.files.length,
            totalSteps: plan.files.length,
            files: fileList,
            currentFile: 'Assembling final package',
            pass: MAX_PASSES,
            totalDuration: jobDuration
        });

        const fileOutput = [];
        for (const fileEntry of fileList) {
            if (fileEntry.status === 'completed' && generatedMap.has(fileEntry.path)) {
                const fileData = generatedMap.get(fileEntry.path);
                const content = (typeof fileData === 'string') ? fileData : fileData.content;
                fileOutput.push(`<file: ${fileEntry.path}>\n${content}\n</file>`);
            }
        }

        const finalOutput = `---
EXPLANATION: ${plan.description || 'Plugin generated successfully'}
PLUGIN_NAME: ${plan.pluginName}
${fileOutput.join('\n\n')}
---`;

        fs.writeFileSync('ai-result.txt', finalOutput, 'utf-8');
        console.log(`\nSaved ${finalOutput.length} chars to ai-result.txt`);

        if (failedFiles.length > 0) {
            const errorMsg = `Could not generate ${failedFiles.length} file(s): ${failedFiles.map(f => f.name).join(', ')}`;
            await updateProgress({
                stage: 'failed',
                currentStep: plan.files.length,
                totalSteps: plan.files.length,
                files: fileList,
                error: errorMsg,
                pass: MAX_PASSES,
                totalDuration: jobDuration
            });
            throw new Error(errorMsg);
        }

        await updateProgress({
            stage: 'completed',
            currentStep: plan.files.length,
            totalSteps: plan.files.length,
            files: fileList,
            currentFile: null,
            pass: MAX_PASSES,
            totalDuration: jobDuration
        });

    } catch (err) {
        console.error('Fatal error:', err.message);
        process.exit(1);
    }
}

main();
