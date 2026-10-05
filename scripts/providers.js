// providers.js (Update these parts)

// 1. Update buildPrompt to accept feedback
function buildPrompt(code, fileName, isPreview, feedback = "") {
    let prompt = `You are an expert AI coding assistant. Your task is to fix the code in the file: ${fileName}.\n`;
    
    if (feedback) {
        prompt += `\n⚠️ PREVIOUS ATTEMPT FAILED! Feedback: ${feedback}\nPlease fix this specific issue in your new response.\n`;
    }

    if (isPreview) {
        prompt += `NOTE: This is a PREVIEW of a large file. Analyze the provided snippet and suggest precise patches or fixes.\n`;
    } else {
        prompt += `Please provide the fully corrected code. Output ONLY the code without markdown formatting.\n`;
    }

    prompt += `\n--- CODE START ---\n${code}\n--- CODE END ---\n`;
    return prompt;
}

// 2. Update fixCodeWithProviders signature
async function fixCodeWithProviders(code, fileName, feedback = "") {
    // ... (large file preview logic remains the same)
    const prompt = buildPrompt(contentToSend, fileName, isPreview, feedback);
    // ... (rest of the provider loop remains the same)
}
 */
function buildPrompt(code, fileName, isPreview) {
    let prompt = `You are an expert AI coding assistant. Your task is to fix the code in the file: ${fileName}.\n`;
    
    if (isPreview) {
        prompt += `NOTE: This is a PREVIEW of a large file. Analyze the provided snippet and suggest precise patches or fixes. Do not attempt to rewrite the entire file from scratch.\n`;
    } else {
        prompt += `Please provide the fully corrected code. Output ONLY the code without markdown formatting or explanations.\n`;
    }

    prompt += `\n--- CODE START ---\n${code}\n--- CODE END ---\n`;
    return prompt;
}

/**
 * Executes the API call for a specific provider
 */
async function executeProviderCall(provider, prompt) {
    const apiKey = process.env[provider.apiKeyEnv];
    if (!apiKey) {
        throw new Error(`API Key missing for environment variable: ${provider.apiKeyEnv}`);
    }

    const headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
    };

    let body = {};

    // Configure body based on provider
    if (provider.name.includes("Anthropic")) {
        headers["x-api-key"] = apiKey;
        headers["anthropic-version"] = "2023-06-01";
        delete headers["Authorization"];
        body = {
            model: provider.model,
            max_tokens: provider.maxTokens,
            messages: [{ role: "user", content: prompt }]
        };
    } else {
        // OpenAI and OpenRouter compatible format
        body = {
            model: provider.model,
            max_tokens: provider.maxTokens,
            messages: [{ role: "user", content: prompt }]
        };
    }

    const response = await fetch(provider.url, {
        method: "POST",
        headers: headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status} - ${response.statusText}. Details: ${errorText}`);
    }

    const data = await response.json();
    
    // Extract content based on provider response structure
    let content = "";
    if (provider.name.includes("Anthropic")) {
        content = data.content[0].text;
    } else {
        content = data.choices[0].message.content;
    }

    // Clean up markdown block if AI ignored instructions
    return content.replace(/```[a-z]*\n/g, '').replace(/```/g, '').trim();
}

/**
 * Main function to fix code using the first available working provider
 */
async function fixCodeWithProviders(code, fileName) {
    // 1. Agentic Behavior: Handle Large Files
    const MAX_SIZE_FOR_AI = 50000; // 50KB
    let contentToSend = code;
    let isPreview = false;

    if (code.length > MAX_SIZE_FOR_AI) {
        contentToSend = code.substring(0, MAX_SIZE_FOR_AI) + "\n\n... [TRUNCATED FOR AI PREVIEW] ...";
        isPreview = true;
        console.log(`[Agentic] Large file detected (${code.length} bytes). Sending preview to AI.`);
    }

    const prompt = buildPrompt(contentToSend, fileName, isPreview);

    // 2. Iterate through providers (Fallback mechanism)
    for (const provider of PROVIDERS) {
        try {
            console.log(`[Agentic] Attempting fix using provider: ${provider.name}...`);
            const fixedCode = await executeProviderCall(provider, prompt);
            
            if (fixedCode) {
                console.log(`[Success] Provider ${provider.name} successfully processed ${fileName}.`);
                return { success: true, fixedCode, provider: provider.name };
            }
        } catch (error) {
            // Phase 3 requirement: Log the EXACT reason for provider failure
            console.error(`[Provider Failure] ${provider.name} failed for ${fileName}.`);
            console.error(`[Exact Reason] ${error.message}`);
            
            // Continue to next provider in the loop
            console.log(`[Fallback] Switching to next provider...`);
        }
    }

    // If all providers fail
    console.error(`[Critical] All AI providers failed to fix ${fileName}.`);
    return { success: false, fixedCode: code, provider: null };
}

module.exports = { fixCodeWithProviders, PROVIDERS };
