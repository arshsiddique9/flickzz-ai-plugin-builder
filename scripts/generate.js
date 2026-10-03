// ============================================
// FlickZZ Builder — Chunked Generation Engine
// Breaks task into small pieces, no token cutoff
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

console.log(`📝 Prompt: ${USER_PROMPT.length} chars`);
console.log(`💬 Is chat: ${IS_CHAT}`);

// ═══════════════════════════════════════════
// SUPABASE HELPERS
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
        console.log(`📊 Progress: ${updates.stage || ''} step ${updates.currentStep || '?'}/${updates.totalSteps || '?'}`);
    } catch (err) {
        console.error('Progress update failed:', err.message);
    }
}

// ═══════════════════════════════════════════
// AI PROVIDER (call with timeout)
// ═══════════════════════════════════════════
async function callAI(systemPrompt, userPrompt, maxTokens = 4000) {
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
            models: ['nemotron-3-ultra-free', 'nemotron-3-super-free']
        },
        {
            name: 'OpenRouter',
            url: 'https://openrouter.ai/api/v1/chat/completions',
            key: OPENROUTER_API_KEY,
            models: ['nvidia/nemotron-3-ultra-550b-a55b:free', 'qwen/qwen3-coder:free'],
            extra: { 'HTTP-Referer': 'https://flickzz.qzz.io', 'X-Title': 'FlickZZ Builder' }
        }
    ];

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
                    console.log(`  ❌ ${res.status}: ${(await res.text()).substring(0, 80)}`);
                    continue;
                }

                const data = await res.json();
                const content = data.choices?.[0]?.message?.content || '';
                const finishReason = data.choices?.[0]?.finish_reason || 'unknown';

                if (content.trim().length === 0) {
                    console.log(`  ❌ Empty response`);
                    continue;
                }

                console.log(`  ✅ ${content.length} chars (${finishReason})`);
                return { ok: true, content, finishReason };
            } catch (err) {
                console.log(`  ❌ ${err.message}`);
            }
        }
    }

    return { ok: false, error: 'All providers failed' };
}

// ═══════════════════════════════════════════
// PLANNING PHASE
// ═══════════════════════════════════════════
async function planPlugin(userPrompt) {
    console.log('\n📋 PLANNING PHASE');

    const systemPrompt = `You are a plugin architect. Your job: analyze the user's request and output ONLY a JSON plan.

OUTPUT FORMAT (strict JSON, no other text):
{
  "pluginName": "FlickZZHomes",
  "description": "Short 1-line description",
  "files": [
    {"path": "pom.xml", "purpose": "Maven build file"},
    {"path": "src/main/resources/plugin.yml", "purpose": "Plugin manifest"},
    {"path": "src/main/resources/config.yml", "purpose": "Config with defaults"},
    {"path": "src/main/java/com/flickzz/generated/FlickZZHomes.java", "purpose": "Main plugin class"},
    {"path": "src/main/java/com/flickzz/generated/HomeManager.java", "purpose": "Data manager"}
  ]
}

RULES:
- Keep total files between 4 and 7 (no more, no less)
- Main class MUST be at index 3 (after pom, plugin.yml, config.yml)
- All Java files use package com.flickzz.generated
- Paper API 1.21.1, Java 21
- Output ONLY the JSON, no explanation, no markdown`;

    const result = await callAI(systemPrompt, userPrompt, 1500);
    if (!result.ok) throw new Error('Planning failed');

    // Extract JSON from response
    let json = result.content.trim();
    if (json.startsWith('```')) {
        json = json.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const startIdx = json.indexOf('{');
    const endIdx = json.lastIndexOf('}');
    if (startIdx === -1 || endIdx === -1) throw new Error('Invalid plan JSON');

    const plan = JSON.parse(json.substring(startIdx, endIdx + 1));
    if (!plan.files || plan.files.length === 0) throw new Error('No files in plan');

    console.log(`  ✅ Planned ${plan.files.length} files for: ${plan.pluginName}`);
    return plan;
}

// ═══════════════════════════════════════════
// GENERATE ONE FILE
// ═══════════════════════════════════════════
async function generateFile(file, plan, alreadyGenerated) {
    console.log(`\n🔨 Generating: ${file.path}`);

    const filesContext = alreadyGenerated.length > 0
        ? `\n\nFILES ALREADY GENERATED (use these for consistency):\n${alreadyGenerated.map(f => `--- ${f.path} ---\n${f.content}`).join('\n\n')}`
        : '\n\n(No files generated yet)';

    const systemPrompt = `You are a Java Bukkit/Paper plugin coder. Generate ONE file only.

PLUGIN: ${plan.pluginName}
FILE PATH: ${file.path}
PURPOSE: ${file.purpose}
PACKAGE: com.flickzz.generated
PAPER API: 1.21.1
JAVA: 21
${filesContext}

CRITICAL RULES:
1. Output ONLY the file content (no markdown, no \`\`\`, no explanation)
2. Use LITERAL < and > characters (never escape)
3. Include ALL necessary imports at the top
4. Use the exact package: com.flickzz.generated
5. For Java files: import every Bukkit class you reference
6. For pom.xml: Paper API 1.21.1-R0.1-SNAPSHOT, Java 21
7. For plugin.yml: api-version: '1.21'
8. For config.yml: include ALL messages with & color codes
9. Verify every method exists in Bukkit/Paper API
10. Add null checks, instanceof checks, try-catch where needed

COMMON MISTAKES TO AVOID:
- Missing imports (import ALL classes you use)
- inventory.getTitle() → use event.getView().getTitle()
- (Player) sender without instanceof check
- File.createNewFile() without try-catch
- Sound.valueOf() / Particle.valueOf() without try-catch
- Private methods called from other classes

OUTPUT ONLY THE FILE CONTENT. START IMMEDIATELY.`;

    const result = await callAI(systemPrompt, `Generate the file: ${file.path}`, 4000);
    if (!result.ok) throw new Error(`Failed to generate ${file.path}`);

    let content = result.content.trim();

    // Remove markdown code fences if AI added them
    content = content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();

    // Remove any leading filename comment
    content = content.replace(/^\/\/\s*(File:|Path:).*\n/i, '');

    console.log(`  ✅ ${content.length} chars`);
    return content;
}

// ═══════════════════════════════════════════
// CHAT/DISCUSSION MODE (single call)
// ═══════════════════════════════════════════
async function handleChat(userPrompt) {
    console.log('\n💬 CHAT MODE');
    
    const systemPrompt = `You are FlickZZ Builder AI — the official AI assistant of FlickZZ Resources, created by Arsh Siddique.

IDENTITY (NEVER BREAK):
- Name: FlickZZ Builder AI
- Creator: Arsh Siddique (FlickZZ Resources)
- NEVER mention: OpenAI, Claude, GPT, Gemini, or any real AI company
- Reply in user's language (Hindi/Hinglish/English)

You handle greetings, questions, and casual conversation. If user asks about plugin building, tell them to describe the plugin and you'll build it.`;

    const result = await callAI(systemPrompt, userPrompt, 1500);
    if (!result.ok) throw new Error('Chat failed');

    return result.content;
}

// ═══════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════
async function main() {
    try {
        // ─── CHAT MODE ───
        if (IS_CHAT) {
            await updateProgress({ stage: 'chatting', currentStep: 1, totalSteps: 1 });
            const response = await handleChat(USER_PROMPT);
            fs.writeFileSync('ai-result.txt', response, 'utf-8');
            await updateProgress({ stage: 'completed', currentStep: 1, totalSteps: 1 });
            console.log('✅ Chat response saved');
            return;
        }

        // ─── BUILD MODE ───
        
        // Step 1: Plan
        await updateProgress({ 
            stage: 'planning', 
            currentStep: 0, 
            totalSteps: 1,
            files: [],
            currentFile: 'Analyzing your plugin request'
        });

        const plan = await planPlugin(USER_PROMPT);

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
            files: fileList,
            currentFile: null
        });

        // Step 2: Generate each file sequentially
        const generatedFiles = [];
        
        for (let i = 0; i < plan.files.length; i++) {
            const file = plan.files[i];

            // Update: current file being generated
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

            try {
                const content = await generateFile(file, plan, generatedFiles);
                generatedFiles.push({ path: file.path, content });

                // Update: file completed
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
                console.error(`❌ Failed to generate ${file.path}:`, err.message);
                
                // Mark file as failed
                const failedFiles = fileList.map((f, idx) => ({
                    ...f,
                    status: idx === i ? 'failed' : (idx < i ? 'completed' : 'pending')
                }));

                await updateProgress({
                    stage: 'failed',
                    currentStep: i + 1,
                    totalSteps: plan.files.length,
                    files: failedFiles,
                    error: `Failed to generate ${file.path}`
                });

                throw err;
            }
        }

        // Step 3: Combine all files into final output
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
        console.log(`\n✅ All ${generatedFiles.length} files generated (${finalOutput.length} chars)`);

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
