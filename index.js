// index.js
const fs = require('fs');
const path = require('path');

console.log(`\n🚀 FlickZZ Agentic Engine\n`);

const args = process.argv.slice(2);
const isProbeMode = args.includes('--probe');
const workspacePath = args.find(a => !a.startsWith('--')) || './plugin-src';
const maxSteps = parseInt(args.find(a => /^\d+$/.test(a))) || 25;

process.env.WORKSPACE_ROOT = path.resolve(workspacePath);

if (isProbeMode) {
    // ── Diagnostic mode ──
    const { probeAll } = require('./scripts/free-models');
    console.log(`🔍 PROBE MODE — testing all providers...\n`);
    probeAll().then(results => {
        console.log(`\n${'═'.repeat(70)}`);
        console.log(`Provider           | Status    | Working Model`);
        console.log(`${'═'.repeat(70)}`);
        for (const r of results) {
            console.log(`${r.provider.padEnd(18)} | ${r.status.padEnd(9)} | ${r.model || '-'}`);
        }
        console.log(`${'═'.repeat(70)}\n`);
        process.exit(0);
    });
    return;
}

// ── Agent mode ──
if (!fs.existsSync(workspacePath)) {
    console.error(`❌ Workspace not found: ${workspacePath}`);
    process.exit(1);
}

const { runAgent } = require('./scripts/agent-loop');

console.log(`📁 Workspace: ${process.env.WORKSPACE_ROOT}`);
console.log(`🔄 Max Steps: ${maxSteps}`);
console.log(`🔑 Available keys: ${[
    'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'AGENTROUTER_API_KEY',
    'TOKENHARBOR_API_KEY', 'UNOROUTER_API_KEY', 'DAHL_API_KEY', 'NARA_API_KEY'
].filter(k => process.env[k]).join(', ')}`);

const prompt = `Fix the Maven build in the workspace.

START by running:
  mvn -B clean package -DskipTests 2>&1 | tail -60

Then read errors, fix Java files, recompile. Repeat.
Call task_complete(true, "summary") when build succeeds.`;

runAgent(prompt, maxSteps)
    .then(r => {
        console.log(`\nAgent result:`, r);
        process.exit(r.success ? 0 : 1);
    })
    .catch(err => {
        console.error(`\n❌ Agent crashed:`, err);
        process.exit(1);
    });
