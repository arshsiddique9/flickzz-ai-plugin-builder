// ============================================
// FlickZZ Builder — Smart Chunked Generation Engine
// Dynamic file count, retry logic, context optimization
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
        const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_jobs?id=eq.${JOB_ID}`, {
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
// AI PROVIDER — with retry & fallback
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
            models: ['nemotron-3-ultra-free', 'nemotron-3-super-free', 'laguna-s-2.1']
        },
        {
            name: 'OpenRouter',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            key: OPENROUTER_API_KEY,
            models: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'qwen/qwen3-coder:free', 'openai/gpt-oss-120b:free'],
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
                        console.log(`  ${res.status}: ${(await res.text()).substring(0, 80)}`);
                        continue;
                    }

                    const data = await res.json();
                    const content = data.choices?.[0]?.message?.content || '';
                    const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

                    if (content.trim().length === 0) {
                        console.log(`  Empty response, trying next...`);
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
// PLANNING PHASE — Dynamic file count
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

    const systemPrompt = `You are an expert Minecraft plugin architect. Analyze the user's request and decide the EXACT number of files needed. Output ONLY a JSON plan.

OUTPUT FORMAT (strict JSON, no other text, no markdown):
{
  "pluginName": "PluginName",
  "description": "1-line description",
  "complexity": "simple" | "medium" | "complex" | "framework",
  "files": [
    {"path": "pom.xml", "purpose": "Maven build file"},
    {"path": "src/main/resources/plugin.yml", "purpose": "Plugin manifest"},
    {"path": "src/main/resources/config.yml", "purpose": "Config with defaults"},
    {"path": "src/main/java/com/flickzz/generated/PluginName.java", "purpose": "Main class"}
  ]
}

═══════════════════════════════════════════
DECISION RULES (FOLLOW STRICTLY)
═══════════════════════════════════════════
Decide file count based on plugin complexity. DO NOT use a fixed number.

SIMPLE (4-5 files):
- 1-2 commands, no GUI, no events
- Example: /spawn plugin
- Files: pom.xml, plugin.yml, config.yml, Main.java

MEDIUM (6-9 files):
- 3-5 commands, basic logic, maybe config
- Example: /sethome /home plugin with cooldown
- Files: pom.xml, plugin.yml, config.yml, Main.java, Manager.java, Data.java

COMPLEX (10-18 files):
- GUI, multiple commands, events, admin commands, permissions
- Example: multi-home with GUI, warmup, particles
- Files: pom.xml, plugin.yml, config.yml, Main.java, Manager.java, Data.java, GUI.java, Command.java, Listener.java, Utils.java

FRAMEWORK (18-35 files):
- Multiple systems, economy, shop, GUI menus, API, events
- Example: SkyBlock core plugin
- Files: many more (break into subsystems)

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════
1. Main Java class file MUST be the FIRST Java file (after pom, plugin.yml, config.yml)
2. ALL Java files use package: com.flickzz.generated
3. Paper API 1.21.1, Java 21
4. Each file must have ONE clear responsibility (SRP)
5. Think about what's really needed:
   - If GUI requested → include a GUI class
   - If many commands → include a Command executor
   - If events needed → include a Listener
   - If config/data → include a Manager
   - If data models → include model classes
6. Don't create unnecessary files. Only what's needed.
7. Output ONLY the JSON. No markdown. No explanation.`;

    const result = await callAI(systemPrompt, userPrompt, 2000);
    if (!result.ok) throw new Error('Planning failed');

    let json = result.content.trim();
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const startIdx = json.indexOf('{');
    const endIdx = json.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) throw new Error('Invalid plan JSON');

    const plan = JSON.parse(json.substring(startIdx, endIdx + 1));
    if (!plan.files || plan.files.length === 0) throw new Error('No files in plan');

    console.log(`Planned ${plan.files.length} files [${plan.complexity || 'unknown'}]:`);
    plan.files.forEach((f, i) => console.log(`  ${i + 1}. ${f.path}`));
    return plan;
}

// ═══════════════════════════════════════════
// SMART CONTEXT — Only include relevant files
// ═══════════════════════════════════════════
function buildContext(file, alreadyGenerated, plan) {
    if (alreadyGenerated.length === 0) return '';

    // For config files (pom, plugin.yml, config.yml) — no context needed
    if (file.path.endsWith('.xml') || file.path.endsWith('.yml') || file.path.endsWith('.yaml')) {
        return '\n\n(No context files needed - this is a resource file)';
    }

    // For Main class — no context needed (it's the first Java file)
    const isMainClass = file.path.endsWith(`/${plan.pluginName}.java`);
    if (isMainClass) {
        return '\n\n(No context files needed - this is the main entry point)';
    }

    // For other Java files — include Main class + related classes
    const relevantFiles = alreadyGenerated.filter(f => {
        // Always include Main class
        if (f.path.endsWith(`/${plan.pluginName}.java`)) return true;
        // Include the immediately previous file for continuity
        const idx = alreadyGenerated.indexOf(f);
        return idx >= alreadyGenerated.length - 2;
    });

    if (relevantFiles.length === 0) return '';

    const contextStr = relevantFiles.map(f =>
        `### ${f.path}\n${f.content}`
    ).join('\n\n');

    return `\n\n═══════════════════════════════════════════
RELEVANT CONTEXT (from already generated files)
═══════════════════════════════════════════
${contextStr}
═══════════════════════════════════════════`;
}

// ═══════════════════════════════════════════
// GENERATE ONE FILE
// ═══════════════════════════════════════════
async function generateFile(file, plan, alreadyGenerated) {
    console.log(`\nGenerating: ${file.path}`);

    const filesContext = buildContext(file, alreadyGenerated, plan);

    const isResource = file.path.endsWith('.xml') || file.path.endsWith('.yml') || file.path.endsWith('.yaml');

    const systemPrompt = `You are an expert Java Bukkit/Paper plugin developer. Generate ONE complete file.

═══════════════════════════════════════════
FILE INFO
═══════════════════════════════════════════
Plugin Name: ${plan.pluginName}
File Path: ${file.path}
Purpose: ${file.purpose}
Package: com.flickzz.generated
Paper API: 1.21.1
Java: 21
File Type: ${isResource ? 'Resource (XML/YAML)' : 'Java Class'}
${filesContext}

═══════════════════════════════════════════
CRITICAL RULES
═══════════════════════════════════════════
1. Output ONLY the raw file content. NO markdown. NO \`\`\`. NO explanation.
2. Use LITERAL < and > characters (never escape them)
3. Include ALL necessary imports at the top (Java files)
4. Package MUST be exactly: com.flickzz.generated
5. For Java: import EVERY class you reference
6. For pom.xml: Paper API 1.21.1-R0.1-SNAPSHOT, Java 21, maven-compiler-plugin 3.13.0
7. For plugin.yml: api-version: '1.21', include all commands + permissions
8. For config.yml: include ALL messages with & color codes
9. Verify every method exists in Bukkit/Paper API 1.21.1
10. Add null checks, instanceof checks, try-catch where needed

═══════════════════════════════════════════
COMMON MISTAKES (AVOID THESE)
═══════════════════════════════════════════
- Missing imports → import EVERYTHING you use
- inventory.getTitle() → use event.getView().getTitle() instead
- (Player) sender without instanceof check → ALWAYS check
- File.createNewFile() without try-catch → wrap in try-catch
- Sound.valueOf() / Particle.valueOf() without try-catch → wrap
- Private methods called from another class → make public
- Using classes not imported → ALWAYS import
- Wrong package → must be com.flickzz.generated
- Bukkit.getWorld() without null check → check for null

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════
Output ONLY the file content. Start immediately with the first line of the file.
NO preamble. NO "here is the file". NO markdown fences.

Begin now.`;

    const result = await callAI(systemPrompt, `Generate the complete file: ${file.path}`, 6000);
    if (!result.ok) throw new Error(`Failed to generate ${file.path}`);

    let content = result.content.trim();

    // Clean up AI artifacts
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
    content = content.replace(/^\/\/\s*(File:|Path:|Here is|This is).*\n/i, '');
    content = content.replace(/^(Here is|This is)[^\n]*\n+/i, '');

    // Remove any trailing explanation
    if (!isResource) {
        // For Java files, ensure it ends with closing brace
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
// CHAT/DISCUSSION MODE
// ═══════════════════════════════════════════
async function handleChat(userPrompt) {
    console.log('\nCHAT MODE');

    const systemPrompt = `You are FlickZZ Builder AI — the official AI assistant of FlickZZ Resources, created by Arsh Siddique.

IDENTITY (NEVER BREAK):
- Your name: FlickZZ Builder AI
- Creator: Arsh Siddique (FlickZZ Resources)
- Platform: FlickZZ Resources (flickzz.qzz.io)
- NEVER mention: OpenAI, Anthropic, Claude, GPT, Gemini, or any real AI company
- If asked "who made you?" → "Main FlickZZ Builder AI hoon, Arsh Siddique ne banaya hai."

BEHAVIOR:
- Reply in user's language (Hindi/Hinglish/English)
- For greetings: be friendly and brief
- For questions: explain clearly
- If user wants a plugin → tell them to describe it and you'll build it
- Keep responses concise (under 200 words for chat)`;

    const result = await callAI(systemPrompt, userPrompt, 1500);
    if (!result.ok) throw new Error('Chat failed');

    return result.content;
}

// ═══════════════════════════════════════════
// VALIDATION — Ensure required files exist
// ═══════════════════════════════════════════
function validatePlan(plan) {
    const paths = plan.files.map(f => f.path.toLowerCase());

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
        // Prepend missing files
        if (!hasPom) {
            plan.files.unshift({ path: 'pom.xml', purpose: 'Maven build file' });
        }
        if (!hasPluginYml) {
            const idx = plan.files.findIndex(f => f.path.includes('pom.xml'));
            plan.files.splice(idx + 1, 0, { path: 'src/main/resources/plugin.yml', purpose: 'Plugin manifest' });
        }
        if (!hasConfigYml) {
            const idx = plan.files.findIndex(f => f.path.includes('plugin.yml'));
            plan.files.splice(idx + 1, 0, { path: 'src/main/resources/config.yml', purpose: 'Configuration file' });
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

        // Initialize progress with file list
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

        // Step 2: Generate each file sequentially with retry
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
