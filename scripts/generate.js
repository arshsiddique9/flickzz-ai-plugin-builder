// ============================================
// FlickZZ Builder — Smart Chunked Generation Engine (v2)
// Fixed: HTML responses, JSON parsing, fallback plan
// ============================================

const fs = require('fs');

const DAHL_API_KEY = process.env.DAHL_API_KEY;
const NARA_API_KEY = process.env.NARA_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const JOB_ID = process.env.JOB_ID;
const PROMPT_B64 = process.env.PROMPT_B64;
const IS_CHAT = process.env.IS_CHAT === 'true';

const USER_PROMPT = Buffer.from(PROMPT_B64 || '', 'base64').toString('utf-8');

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
        console.log(`Progress [${updates.stage || '?'}] step ${updates.currentStep || 0}/${updates.totalSteps || 0}`);
    } catch (err) {
        console.error('Progress update failed:', err.message);
    }
}

// ═══════════════════════════════════════════
// 🔧 CONTENT VALIDATION — Reject HTML/errors
// ═══════════════════════════════════════════
function isValidContent(content) {
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length === 0) return false;

    // Reject HTML responses (Cloudflare error pages, etc.)
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<HTML')) {
        return false;
    }

    // Reject Cloudflare/error JSON envelopes
    if (trimmed.startsWith('{') && /"(error|errors|message)".*"(rate|limit|unavailable|forbidden|not found|model_)/i.test(trimmed.substring(0, 300))) {
        return false;
    }

    // Reject very short responses
    if (trimmed.length < 20) return false;

    return true;
}

// ═══════════════════════════════════════════
// AI PROVIDER — with retry, fallback, validation
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
                try {
                    console.log(`[${provider.name}] ${model} (max ${maxTokens} tokens)`);

                    const headers = {
                        'Authorization': `Bearer ${provider.key}`,
                        'Content-Type': 'application/json',
                        ...(provider.extra || {})
                    };

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 240000);

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
                        continue;
                    }

                    // 🔧 Check content-type to reject HTML
                    const contentType = res.headers.get('content-type') || '';
                    if (!contentType.includes('application/json')) {
                        console.log(`  Invalid content-type: ${contentType}`);
                        continue;
                    }

                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

                    // 🔧 Validate content
                    if (!isValidContent(content)) {
                        console.log(`  Invalid/empty response (${content.length} chars), trying next...`);
                        continue;
                    }

                    // If output was cut due to token limit, retry
                    if (finishReason === 'length' && attempt < retries) {
                        console.log(`  Hit token limit, will retry...`);
                        break;
                    }

                    console.log(`  ${content.length} chars (${finishReason})`);
                    return { ok: true, content, finishReason, provider: provider.name, model };
                } catch (err) {
                    console.log(`  ${err.message}`);
                }
            }
        }
    }

    return { ok: false, error: 'All providers failed' };
}

// ═══════════════════════════════════════════
// 🔧 ROBUST JSON EXTRACTOR
// ═══════════════════════════════════════════
function extractJSON(text) {
    if (!text) return null;

    let json = text.trim();

    // Remove BOM
    json = json.replace(/^\uFEFF/, '');

    // Remove markdown fences
    json = json.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

    // Remove thinking tags
    json = json.replace(/<think>[\s\S]*?<\/think>/gi, '');
    json = json.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');

    // Find the JSON boundaries
    const startIdx = json.indexOf('{');
    const endIdx = json.lastIndexOf('}');

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        return null;
    }

    json = json.substring(startIdx, endIdx + 1);

    // Try parsing
    try {
        return JSON.parse(json);
    } catch (err) {
        console.log(`  JSON parse failed: ${err.message}`);

        // Clean up common issues
        json = json
            .replace(/,\s*}/g, '}')
            .replace(/,\s*]/g, ']')
            .replace(/\/\/[^\n]*/g, '')  // Remove // comments
            .replace(/\/\*[\s\S]*?\*\//g, '');  // Remove /* */ comments

        try {
            return JSON.parse(json);
        } catch (retryErr) {
            console.log(`  JSON parse failed after cleanup: ${retryErr.message}`);
            console.log(`  Preview: ${json.substring(0, 300)}`);
            return null;
        }
    }
}

// ═══════════════════════════════════════════
// 🔧 FALLBACK PLAN — If AI planning fails
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
            { path: `src/main/java/${pkg.replace(/\./g, '/')}/${pluginName}.java`, purpose: 'Main plugin class' }
        ]
    };
}

// ═══════════════════════════════════════════
// PLANNING PHASE
// ═══════════════════════════════════════════
async function planPlugin(userPrompt) {
    console.log('\nPLANNING PHASE');
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

FILE COUNT RULES (choose based on complexity):
- Simple (1-2 commands): 4-5 files
- Medium (3-5 commands): 6-9 files
- Complex (GUI, admin, events): 10-18 files
- Framework (multi-system): 18-35 files

REQUIRED FILES (ALWAYS include):
1. pom.xml
2. src/main/resources/plugin.yml
3. src/main/resources/config.yml (if configurable)
4. Main class (JavaPlugin subclass) — MUST be FIRST Java file

STANDARDS:
- Paper API 1.21.1, Java 21
- Package: com.flickzz.generated
- Each file = ONE clear purpose

Output ONLY the JSON object now. Start with {`;

    const result = await callAI(systemPrompt, userPrompt, 3000);
    
    if (!result.ok) {
        console.log('  All providers failed for planning, using fallback plan');
        return getFallbackPlan();
    }

    const plan = extractJSON(result.content);
    
    if (!plan || !plan.files || !Array.isArray(plan.files) || plan.files.length === 0) {
        console.log('  Invalid plan from AI, using fallback plan');
        console.log(`  Raw response preview: ${result.content.substring(0, 500)}`);
        return getFallbackPlan();
    }

    // Ensure pluginName exists
    if (!plan.pluginName) {
        plan.pluginName = 'GeneratedPlugin';
    }

    // Sanitize pluginName (only alphanumeric)
    plan.pluginName = plan.pluginName.replace(/[^a-zA-Z0-9]/g, '');

    console.log(`Planned ${plan.files.length} files [${plan.complexity || 'unknown'}]:`);
    plan.files.forEach((f, i) => console.log(`  ${i + 1}. ${f.path}`));
    return plan;
}

// ═══════════════════════════════════════════
// SMART CONTEXT
// ═══════════════════════════════════════════
function buildContext(file, alreadyGenerated, plan) {
    if (alreadyGenerated.length === 0) return '';

    if (file.path.endsWith('.xml') || file.path.endsWith('.yml') || file.path.endsWith('.yaml')) {
        return '\n\n(No context files needed - resource file)';
    }

    const isMainClass = file.path.endsWith(`/${plan.pluginName}.java`);
    if (isMainClass) {
        return '\n\n(No context needed - main entry point)';
    }

    const relevantFiles = alreadyGenerated.filter(f => {
        if (f.path.endsWith(`/${plan.pluginName}.java`)) return true;
        const idx = alreadyGenerated.indexOf(f);
        return idx >= alreadyGenerated.length - 2;
    });

    if (relevantFiles.length === 0) return '';

    const contextStr = relevantFiles.map(f =>
        `### ${f.path}\n${f.content}`
    ).join('\n\n');

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
- Wrong package
- Bukkit.getWorld() without null check
- getCommand("x") without null check

Output ONLY the file content. Start immediately. NO preamble.`;

    const result = await callAI(systemPrompt, `Generate the complete file: ${file.path}`, 6000);
    if (!result.ok) throw new Error(`Failed to generate ${file.path}`);

    let content = result.content.trim();

    // Clean up AI artifacts
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    content = content.replace(/^\/\/\s*(File:|Path:|Here is|This is).*\n/i, '');
    content = content.replace(/^(Here is|This is|Sure|Okay|Alright)[^\n]*\n+/i, '');

    // For Java files, trim to last closing brace
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
- If asked "who made you?" → "Main FlickZZ Builder AI hoon, Arsh Siddique ne banaya hai."

BEHAVIOR:
- Reply in user's language (Hindi/Hinglish/English)
- Keep responses short (under 100 words)
- Do NOT use any thinking tags or internal monologue
- Reply directly`;

    const result = await callAI(systemPrompt, userPrompt, 1500);
    if (!result.ok) throw new Error('Chat failed');

    // Strip thinking tags from chat too
    let response = result.content;
    response = response.replace(/<think>[\s\S]*?<\/think>/gi, '');
    response = response.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    response = response.replace(/<\/?think>/gi, '').trim();

    return response;
}

// ═══════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════
function validatePlan(plan) {
    const paths = plan.files.map(f => f.path.toLowerCase());
    const pkg = 'com.flickzz.generated';

    const hasPom = paths.some(p => p.includes('pom.xml'));
    const hasPluginYml = paths.some(p => p.includes('plugin.yml'));
    const hasConfigYml = paths.some(p => p.includes('config.yml'));
    const hasMainClass = paths.some(p => p.endsWith(`${plan.pluginName.toLowerCase()}.java`));

    const missing = [];
    if (!hasPom) missing.push('pom.xml');
    if (!hasPluginYml) missing.push('plugin.yml');
    if (!hasMainClass) missing.push(`${plan.pluginName}.java`);

    if (missing.length > 0) {
        console.log(`Auto-fixing missing files: ${missing.join(', ')}`);
        
        if (!hasPom) {
            plan.files.unshift({ path: 'pom.xml', purpose: 'Maven build file' });
        }
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
    }

    return plan;
}

// ═══════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════
async function main() {
    try {
        // CHAT MODE
        if (IS_CHAT) {
            await updateProgress({ stage: 'chatting', currentStep: 1, totalSteps: 1 });
            const response = await handleChat(USER_PROMPT);
            fs.writeFileSync('ai-result.txt', response, 'utf-8');
            await updateProgress({ stage: 'completed', currentStep: 1, totalSteps: 1 });
            console.log('Chat response saved');
            return;
        }

        // BUILD MODE
        console.log('\n═══ BUILD MODE ═══');

        // Step 1: Plan
        let plan = await planPlugin(USER_PROMPT);
        plan = validatePlan(plan);

        // Initialize progress
        const fileList = plan.files.map(f => ({
            path: f.path,
            name: f.path.split('/').pop(),
            status: 'pending',
            size: 0
        }));

        await updateProgress({
            stage: 'planned',
            currentStep: 0,
            totalSteps: plan.files.length,
            pluginName: plan.pluginName,
            complexity: plan.complexity,
            files: fileList,
            currentFile: null
        });

        // Step 2: Generate each file
        const generatedFiles = [];
        const MAX_FILE_RETRIES = 2;

        for (let i = 0; i < plan.files.length; i++) {
            const file = plan.files[i];

            const filesState = fileList.map((f, idx) => ({
                ...f,
                status: idx < i ? 'completed' : (idx === i ? 'generating' : 'pending')
            }));

            await updateProgress({
                stage: 'generating',
                currentStep: i + 1,
                totalSteps: plan.files.length,
                files: filesState,
                currentFile: file.path
            });

            let success = false;
            let lastError = null;

            for (let attempt = 0; attempt <= MAX_FILE_RETRIES && !success; attempt++) {
                try {
                    if (attempt > 0) {
                        console.log(`  Retry ${attempt}/${MAX_FILE_RETRIES} for ${file.path}`);
                        await new Promise(r => setTimeout(r, 3000));
                    }

                    const content = await generateFile(file, plan, generatedFiles);
                    generatedFiles.push({ path: file.path, content });
                    success = true;

                    const updatedFiles = fileList.map((f, idx) => ({
                        ...f,
                        status: idx <= i ? 'completed' : 'pending',
                        size: idx === i ? content.length : f.size
                    }));

                    await updateProgress({
                        stage: 'generating',
                        currentStep: i + 1,
                        totalSteps: plan.files.length,
                        files: updatedFiles,
                        currentFile: null
                    });
                } catch (err) {
                    lastError = err;
                    console.error(`  Attempt ${attempt + 1} failed:`, err.message);
                }
            }

            if (!success) {
                console.error(`File ${file.path} failed after ${MAX_FILE_RETRIES + 1} attempts`);

                const failedFiles = fileList.map((f, idx) => ({
                    ...f,
                    status: idx === i ? 'failed' : (idx < i ? 'completed' : 'pending')
                }));

                await updateProgress({
                    stage: 'failed',
                    currentStep: i + 1,
                    totalSteps: plan.files.length,
                    files: failedFiles,
                    error: `Failed to generate ${file.path}: ${lastError?.message}`
                });

                throw lastError;
            }
        }

        // Step 3: Finalize
        await updateProgress({
            stage: 'finalizing',
            currentStep: plan.files.length,
            totalSteps: plan.files.length,
            files: fileList.map(f => ({ ...f, status: 'completed' })),
            currentFile: 'Assembling final package'
        });

        const fileOutput = generatedFiles.map(f =>
            `<file: ${f.path}>\n${f.content}\n</file>`
        ).join('\n\n');

        const finalOutput = `---
EXPLANATION: ${plan.description || 'Plugin generated successfully'}
PLUGIN_NAME: ${plan.pluginName}
${fileOutput}
---`;

        fs.writeFileSync('ai-result.txt', finalOutput, 'utf-8');
        console.log(`\nAll ${generatedFiles.length} files generated (${finalOutput.length} chars)`);

        await updateProgress({
            stage: 'completed',
            currentStep: plan.files.length,
            totalSteps: plan.files.length,
            files: fileList.map(f => ({ ...f, status: 'completed' })),
            currentFile: null
        });

    } catch (err) {
        console.error('Fatal error:', err.message);
        process.exit(1);
    }
}

main();
