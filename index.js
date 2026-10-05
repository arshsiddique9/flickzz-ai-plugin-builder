// index.js
// Agentic entry point — pre-pass with orchestrator, then agent

const fs = require('fs');
const path = require('path');

console.log(`\n🚀 FlickZZ Agentic Engine\n`);

const args = process.argv.slice(2);
const isProbeMode = args.includes('--probe');
const workspacePath = args.find(a => !a.startsWith('--')) || './plugin-src';
const maxSteps = parseInt(args.find(a => /^\d+$/.test(a))) || 25;
const logPath = args[1] && args[1].endsWith('.log') ? args[1] : null;
const contextPath = args[2] && args[2].endsWith('.json') ? args[2] : null;

process.env.WORKSPACE_ROOT = path.resolve(workspacePath);

// ═══════════════════════════════════════════
// PROBE MODE
// ═══════════════════════════════════════════
if (isProbeMode) {
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

// ═══════════════════════════════════════════
// AGENT MODE
// ═══════════════════════════════════════════
if (!fs.existsSync(workspacePath)) {
    console.error(`❌ Workspace not found: ${workspacePath}`);
    process.exit(1);
}

const { runAgent } = require('./scripts/agent-loop');

console.log(`📁 Workspace: ${process.env.WORKSPACE_ROOT}`);
console.log(`🔄 Max Steps: ${maxSteps}`);
console.log(`📄 Log: ${logPath || 'not provided'}`);
console.log(`📋 Context: ${contextPath || 'not provided'}`);
console.log(`🔑 Available keys: ${[
    'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'AGENTROUTER_API_KEY',
    'TOKENHARBOR_API_KEY', 'UNOROUTER_API_KEY', 'DAHL_API_KEY', 'NARA_API_KEY'
].filter(k => process.env[k]).join(', ')}\n`);

async function main() {
    // ═══════════════════════════════════════════
    // PRE-PASS: Deterministic fixes + missing files
    // (Runs BEFORE agent, so agent sees cleaner code)
    // ═══════════════════════════════════════════
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🔧 PRE-PASS — orchestrator cleaning`);
    console.log(`${'═'.repeat(60)}\n`);

    try {
        const { processDirectory } = require('./scripts/orchestrator');
        await processDirectory(workspacePath, logPath || '', contextPath || '', '');
        console.log(`\n✅ Pre-pass complete\n`);
    } catch (err) {
        console.warn(`⚠️ Pre-pass failed: ${err.message}`);
        console.warn(`   Continuing to agent anyway...\n`);
    }

    // ═══════════════════════════════════════════
    // MAIN PASS: Agent
    // ═══════════════════════════════════════════
    const prompt = `Fix the Maven build in the workspace.

START by running:
  mvn -B clean package -DskipTests 2>&1 | tail -60

Then read errors, fix Java files, recompile. Repeat until build succeeds.
Read files with read_file before writing. Use write_file with COMPLETE file content.
Call task_complete(true, "summary") when build succeeds.`;

    console.log(`${'═'.repeat(60)}`);
    console.log(`🤖 AGENT MODE`);
    console.log(`${'═'.repeat(60)}\n`);

    const result = await runAgent(prompt, maxSteps);
    console.log(`\nAgent result:`, result);
    process.exit(result.success ? 0 : 1);
}

main().catch(err => {
    console.error(`\n❌ Fatal error:`, err);
    process.exit(1);
});
