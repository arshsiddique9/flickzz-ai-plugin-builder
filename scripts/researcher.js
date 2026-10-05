// scripts/researcher.js

const fs = require('fs');
const path = require('path');

/**
 * RESEARCHER AGENT: Scans Java files to find external dependencies.
 * It ignores standard Java/JDK imports and only extracts third-party libraries.
 */
function researchDependencies(dirPath) {
    console.log(`[Researcher Agent] 🔍 Scanning for external dependencies in ${dirPath}...`);
    
    let externalDeps = new Set();

    function scanFiles(currentPath) {
        if (!fs.existsSync(currentPath)) return;
        
        const files = fs.readdirSync(currentPath, { withFileTypes: true });
        
        for (const file of files) {
            const fullPath = path.join(currentPath, file.name);
            
            if (file.isDirectory()) {
                scanFiles(fullPath);
            } else if (file.name.endsWith('.java')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                // Regex to find import statements that are NOT java. or javax.
                const importRegex = /^import\s+(?!java\.|javax\.)([a-zA-Z0-9_.]+);/gm;
                let match;
                while ((match = importRegex.exec(content)) !== null) {
                    // Extract base package (e.g., org.bukkit from org.bukkit.plugin.java)
                    const pkg = match[1].split('.').slice(0, 3).join('.');
                    externalDeps.add(pkg);
                }
            }
        }
    }

    scanFiles(dirPath);
    
    const depsArray = Array.from(externalDeps);
    console.log(`[Researcher Agent] ✅ Found ${depsArray.length} unique external dependencies.`);
    
    if (depsArray.length > 0) {
        console.log(`[Researcher Agent] Detected: ${depsArray.join(', ')}`);
    }
    
    return depsArray;
}

module.exports = { researchDependencies };
