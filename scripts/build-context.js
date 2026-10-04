// ============================================
// FlickZZ Build Context Generator
// Saves project metadata for the auto-fixer
// ============================================

const fs = require('fs');
const path = require('path');

const USER_PROMPT = process.env.USER_PROMPT || 'Unknown plugin request';
const PROJECT_DIR = process.cwd();

function buildContext() {
    const context = {
        userPrompt: USER_PROMPT,
        generatedAt: new Date().toISOString(),
        pluginName: 'Unknown',
        files: [],
        dependencyMap: {},
        packageStructure: {}
    };

    // Find all Java files and their purposes
    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
            if (entry === 'target' || entry === '.git') continue;
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                walk(full);
            } else if (full.endsWith('.java')) {
                const relPath = path.relative(PROJECT_DIR, full).replace(/\\/g, '/');
                const content = fs.readFileSync(full, 'utf-8');

                // Extract class name and package
                const packageMatch = content.match(/^package\s+([\w\.]+);/m);
                const classMatch = content.match(/public\s+(class|interface|enum)\s+(\w+)/);

                // Extract imports
                const imports = [...content.matchAll(/^import\s+([\w\.\*]+);/gm)].map(m => m[1]);

                // Extract public methods
                const methods = [...content.matchAll(/public\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/g)].map(m => m[1]);

                context.files.push({
                    path: relPath,
                    package: packageMatch ? packageMatch[1] : null,
                    className: classMatch ? classMatch[2] : null,
                    type: classMatch ? classMatch[1] : null,
                    lineCount: content.split('\n').length,
                    charCount: content.length,
                    imports: imports,
                    publicMethods: methods
                });

                // Track packages
                if (packageMatch) {
                    const pkg = packageMatch[1];
                    if (!context.packageStructure[pkg]) context.packageStructure[pkg] = [];
                    context.packageStructure[pkg].push(relPath);
                }
            }
        }
    }
    walk(PROJECT_DIR);

    // Detect plugin name from main class
    const mainClass = context.files.find(f => f.path.includes('/FzHomes.java') || f.path.includes('/' + (context.files[0]?.className || 'Plugin') + '.java'));
    if (mainClass) context.pluginName = mainClass.className;

    // Save
    fs.writeFileSync(path.join(PROJECT_DIR, 'project-context.json'), JSON.stringify(context, null, 2));
    console.log(`[Context] Saved context for ${context.files.length} files`);
    console.log(`[Context] Plugin: ${context.pluginName}`);
    console.log(`[Context] User prompt: ${USER_PROMPT.substring(0, 100)}...`);
}

buildContext();
