// scripts/verifier.js

const fs = require('fs');
const { execSync } = require('child_process');

/**
 * VERIFIER AGENT: Validates the final built JAR.
 * Checks file size, presence of plugin.yml, and compiled .class files.
 */
function verifyJar(jarPath) {
    console.log(`\n[Verifier Agent] 🕵️ Validating JAR at: ${jarPath}`);
    
    if (!jarPath || !fs.existsSync(jarPath)) {
        throw new Error(`[Verifier Agent] ❌ JAR file not found at: ${jarPath}`);
    }

    const stats = fs.statSync(jarPath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    console.log(`[Verifier Agent] 📦 File Size: ${fileSizeInMB.toFixed(2)} MB`);

    if (fileSizeInMB < 0.01) { // Less than 10KB is definitely broken
        throw new Error(`[Verifier Agent] ❌ JAR file is too small (${fileSizeInMB.toFixed(2)} MB). Build is likely corrupted.`);
    }

    try {
        // Use unzip to list contents of the JAR
        const jarContents = execSync(`unzip -l "${jarPath}"`).toString();
        
        const hasPluginYml = jarContents.includes('plugin.yml') || jarContents.includes('paper-plugin.yml');
        const hasClasses = jarContents.includes('.class');
        
        if (!hasPluginYml) {
            console.warn(`[Verifier Agent] ⚠️ WARNING: No plugin.yml found inside the JAR! The plugin might not load.`);
        }
        
        if (!hasClasses) {
            throw new Error(`[Verifier Agent] ❌ CRITICAL: No compiled .class files found inside the JAR!`);
        }

        console.log(`[Verifier Agent] ✅ JAR validated successfully! (${fileSizeInMB.toFixed(2)} MB)`);
        return true;

    } catch (error) {
        throw new Error(`[Verifier Agent] Validation failed: ${error.message}`);
    }
}

module.exports = { verifyJar };
