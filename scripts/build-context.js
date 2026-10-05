// ============================================
// FlickZZ Build Context Generator
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
        packageStructure: {}
    };

    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
            if (entry === 'target' || entry === '.git' || entry === 'node_modules') continue;
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                walk(full);
            } else if (full.endsWith('.java')) {
                const relPath = path.relative(PROJECT_DIR, full).replace(/\\/g, '/');
                const content = fs.readFileSync(full, 'utf-8');
                const packageMatch = content.match(/^package\s+([\w\.]+);/m);
                const classMatch = content.match(/public\s+(class|interface|enum)\s+(\w+)/);
                const imports = [...content.matchAll(/^import\s+([\w\.\*]+);/gm)].map(m => m[1]);
                const methods = [...content.matchAll(/public\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/g)].map(m => m[1]);

                context.files.push({
                    path: relPath,
                    package: packageMatch ? packageMatch[1] : null,
                    className: classMatch ? classMatch[2] : null,
                    type: classMatch ? classMatch[1] : null,
                    lineCount: content.split('\n').length,
                    charCount: content.length,
                    imports,
                    publicMethods: methods
                });

                if (packageMatch) {
                    const pkg = packageMatch[1];
                    if (!context.packageStructure[pkg]) context.packageStructure[pkg] = [];
                    context.packageStructure[pkg].push(relPath);
                }
            }
        }
    }
    walk(PROJECT_DIR);

    // Detect plugin name
    const mainClass = context.files.find(f => /Main|Plugin|Fz\w+/.test(f.className || ''));
    if (mainClass) context.pluginName = mainClass.className;

    fs.writeFileSync(path.join(PROJECT_DIR, 'project-context.json'), JSON.stringify(context, null, 2));
    console.log(`[Context] Saved: ${context.files.length} files, plugin: ${context.pluginName}`);
    console.log(`[Context] User prompt: ${USER_PROMPT.substring(0, 100)}`);
}

buildContext();
