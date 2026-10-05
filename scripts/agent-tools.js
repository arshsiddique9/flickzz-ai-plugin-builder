// scripts/agent-tools.js
// Tool definitions + executors for the agent

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || './plugin-src';

// ═══════════════════════════════════════════
// Tool Schemas (OpenAI/OpenRouter format)
// ═══════════════════════════════════════════
const TOOL_SCHEMAS = [
    {
        type: "function",
        function: {
            name: "read_file",
            description: "Read a file's contents from the workspace. Use this to inspect Java files, pom.xml, plugin.yml, or any project file.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative path from workspace root. Example: src/main/java/com/flickzz/generated/FlickZZHomes.java" }
                },
                required: ["path"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "write_file",
            description: "Write or overwrite a file with new content. Use this to fix code.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative path from workspace root" },
                    content: { type: "string", description: "Full file content to write" }
                },
                required: ["path", "content"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_files",
            description: "List files in a directory (recursive). Use this to see project structure.",
            parameters: {
                type: "object",
                properties: {
                    path: { type: "string", description: "Relative directory path. Default: '.'" }
                }
            }
        }
    },
    {
        type: "function",
        function: {
            name: "run_command",
            description: "Run a shell command in the workspace (e.g., 'mvn -B compile', 'ls', 'cat file.java'). Use this to compile and see errors.",
            parameters: {
                type: "object",
                properties: {
                    command: { type: "string", description: "The shell command to run" }
                },
                required: ["command"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "task_complete",
            description: "Call this when the build succeeds or the task is complete. This ends the agent loop.",
            parameters: {
                type: "object",
                properties: {
                    success: { type: "boolean", description: "true if build succeeded, false if giving up" },
                    summary: { type: "string", description: "Brief summary of what was done" }
                },
                required: ["success", "summary"]
            }
        }
    }
];

// ═══════════════════════════════════════════
// Tool Executors
// ═══════════════════════════════════════════

function safePath(relativePath) {
    const abs = path.resolve(WORKSPACE_ROOT, relativePath);
    const root = path.resolve(WORKSPACE_ROOT);
    if (!abs.startsWith(root)) {
        throw new Error(`Path outside workspace: ${relativePath}`);
    }
    return abs;
}

function executeTool(toolName, args) {
    try {
        switch (toolName) {
            case 'read_file': {
                const fp = safePath(args.path);
                if (!fs.existsSync(fp)) return { error: `File not found: ${args.path}` };
                const content = fs.readFileSync(fp, 'utf8');
                const lines = content.split('\n');
                // Return with line numbers for clarity
                const numbered = lines.map((l, i) => `${String(i + 1).padStart(4, ' ')} | ${l}`).join('\n');
                return { content: numbered, totalLines: lines.length };
            }

            case 'write_file': {
                const fp = safePath(args.path);
                fs.mkdirSync(path.dirname(fp), { recursive: true });
                fs.writeFileSync(fp, args.content, 'utf8');
                return { success: true, path: args.path, bytes: args.content.length };
            }

            case 'list_files': {
                const dir = safePath(args.path || '.');
                if (!fs.existsSync(dir)) return { error: `Directory not found: ${args.path}` };
                const results = [];
                function walk(d, prefix = '') {
                    if (results.length > 200) return;
                    const entries = fs.readdirSync(d, { withFileTypes: true });
                    for (const e of entries) {
                        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'target') continue;
                        const rel = prefix ? `${prefix}/${e.name}` : e.name;
                        if (e.isDirectory()) walk(path.join(d, e.name), rel);
                        else results.push(rel);
                    }
                }
                walk(dir);
                return { files: results, count: results.length };
            }

            case 'run_command': {
                const cmd = args.command;
                // Safety: block dangerous commands
                const blocked = ['rm -rf /', 'sudo', 'curl', 'wget', 'chmod +x'];
                if (blocked.some(b => cmd.includes(b))) {
                    return { error: `Command blocked for safety: ${cmd}` };
                }
                try {
                    const output = execSync(cmd, {
                        cwd: WORKSPACE_ROOT,
                        encoding: 'utf8',
                        timeout: 120000,
                        maxBuffer: 5 * 1024 * 1024,
                        stdio: ['ignore', 'pipe', 'pipe']
                    });
                    return { exitCode: 0, output: output.slice(-8000) }; // last 8KB
                } catch (err) {
                    const stdout = err.stdout ? err.stdout.toString() : '';
                    const stderr = err.stderr ? err.stderr.toString() : '';
                    const combined = (stdout + '\n' + stderr).slice(-8000);
                    return { exitCode: err.status || 1, output: combined };
                }
            }

            case 'task_complete': {
                return { acknowledged: true, ...args };
            }

            default:
                return { error: `Unknown tool: ${toolName}` };
        }
    } catch (err) {
        return { error: err.message };
    }
}

module.exports = { TOOL_SCHEMAS, executeTool };
