// index.js
// Agentic entry point — reads workspace, spawns agent, fixes build

const fs = require('fs');
const path = require('path');
const { runAgent } = require('./scripts/agent-loop');

const args = process.argv.slice(2);
const workspacePath = args[0] || './plugin-src';
const maxSteps = parseInt(args[1]) || 25;

if (!fs.existsSync(workspacePath)) {
    console.error(`❌ Workspace not found: ${workspacePath}`);
    process.exit(1);
}

process.env.WORKSPACE_ROOT = path.resolve(workspacePath);

console.log(`\n🚀 FlickZZ Agentic Engine`);
console.log(`📁 Workspace: ${path.resolve(workspacePath)}`);
console.log(`🔄 Max Steps: ${maxSteps}\n`);

const initialPrompt = `You are working in the directory: ${process.env.WORKSPACE_ROOT}

Your job: fix the Maven build so it compiles successfully.

START NOW by running:
  mvn -B clean package -DskipTests 2>&1 | tail -60

Then read the errors, fix the code with write_file, and recompile. Repeat until success.
When the build succeeds, call task_complete(true, "...").`;

runAgent(initialPrompt, maxSteps)
    .then(result => {
        if (result.success) {
            console.log(`\n✅ Agent succeeded: ${result.summary}`);
            process.exit(0);
        } else {
            console.error(`\n❌ Agent failed: ${result.reason}`);
            process.exit(1);
        }
    })
    .catch(err => {
        console.error(`\n❌ Agent crashed:`, err);
        process.exit(1);
    });
