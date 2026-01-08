/**
 * Integrate command - Wire RUDI stacks into agent configs
 *
 * Each integration:
 * - Detects the agent's config format
 * - Creates backup before modifying
 * - Patches idempotently (won't duplicate entries)
 * - Registers the generic shim, not individual stacks
 *
 * Usage:
 *   rudi integrate claude      Wire up Claude Desktop/Code
 *   rudi integrate cursor      Wire up Cursor
 *   rudi integrate gemini      Wire up Gemini CLI
 *   rudi integrate all         Wire up all detected agents
 */

import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { PATHS } from '@learnrudi/env';
import { AGENT_CONFIGS, findAgentConfig, getInstalledAgents } from '@learnrudi/mcp';

const HOME = os.homedir();
const SHIM_PATH = path.join(PATHS.home, 'shims', 'rudi-mcp');

/**
 * Get list of installed stacks
 */
function getInstalledStacks() {
  const stacksDir = PATHS.stacks;
  if (!fs.existsSync(stacksDir)) return [];

  return fs.readdirSync(stacksDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .filter(d => fs.existsSync(path.join(stacksDir, d.name, 'manifest.json')))
    .map(d => d.name);
}

/**
 * Ensure the generic shim exists
 */
function ensureShim() {
  const shimsDir = path.dirname(SHIM_PATH);
  if (!fs.existsSync(shimsDir)) {
    fs.mkdirSync(shimsDir, { recursive: true });
  }

  // The shim calls npx @learnrudi/cli which works globally
  // Or if rudi is in PATH, it can use that directly
  const shimContent = `#!/usr/bin/env bash
set -euo pipefail
# Try rudi in PATH first, fall back to npx
if command -v rudi &> /dev/null; then
  exec rudi mcp "$1"
else
  exec npx --yes @learnrudi/cli mcp "$1"
fi
`;

  // Check if we need to write (or update)
  if (fs.existsSync(SHIM_PATH)) {
    const existing = fs.readFileSync(SHIM_PATH, 'utf-8');
    if (existing === shimContent) {
      return { created: false, path: SHIM_PATH };
    }
  }

  fs.writeFileSync(SHIM_PATH, shimContent, { mode: 0o755 });
  return { created: true, path: SHIM_PATH };
}

/**
 * Create backup of config file
 */
function backupConfig(configPath) {
  if (!fs.existsSync(configPath)) return null;

  const backupPath = configPath + '.backup.' + Date.now();
  fs.copyFileSync(configPath, backupPath);
  return backupPath;
}

/**
 * Read JSON config safely
 */
function readJsonConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * Write JSON config
 */
function writeJsonConfig(configPath, config) {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Build MCP server entry for a stack (using shim)
 * Format varies slightly by agent
 */
function buildMcpEntry(stackName, agentId) {
  const base = {
    command: SHIM_PATH,
    args: [stackName],
  };

  // Claude Desktop and Claude Code need "type": "stdio"
  if (agentId === 'claude-desktop' || agentId === 'claude-code') {
    return { type: 'stdio', ...base };
  }

  return base;
}

/**
 * Integrate stacks into a specific agent
 */
async function integrateAgent(agentId, stacks, flags) {
  const agentConfig = AGENT_CONFIGS.find(a => a.id === agentId);
  if (!agentConfig) {
    console.error(`Unknown agent: ${agentId}`);
    return { success: false, error: 'Unknown agent' };
  }

  const configPath = findAgentConfig(agentConfig);

  // If config doesn't exist, create it
  const configDir = configPath ? path.dirname(configPath) : null;
  const targetPath = configPath || path.join(HOME, agentConfig.paths[process.platform]?.[0] || agentConfig.paths.darwin[0]);

  console.log(`\n${agentConfig.name}:`);
  console.log(`  Config: ${targetPath}`);

  // Backup existing config
  if (fs.existsSync(targetPath)) {
    const backup = backupConfig(targetPath);
    if (backup && flags.verbose) {
      console.log(`  Backup: ${backup}`);
    }
  }

  // Read existing config
  const config = readJsonConfig(targetPath);

  // Ensure the MCP servers key exists
  const key = agentConfig.key;
  if (!config[key]) {
    config[key] = {};
  }

  // Add/update each stack
  let added = 0;
  let updated = 0;

  for (const stackName of stacks) {
    const entry = buildMcpEntry(stackName, agentId);
    const existing = config[key][stackName];

    if (!existing) {
      config[key][stackName] = entry;
      added++;
    } else if (existing.command !== entry.command || JSON.stringify(existing.args) !== JSON.stringify(entry.args)) {
      config[key][stackName] = entry;
      updated++;
    }
  }

  // Write config
  if (added > 0 || updated > 0) {
    writeJsonConfig(targetPath, config);
    console.log(`  Added: ${added}, Updated: ${updated}`);
  } else {
    console.log(`  Already up to date`);
  }

  return { success: true, added, updated };
}

/**
 * Main integrate command
 */
export async function cmdIntegrate(args, flags) {
  const target = args[0];

  if (!target) {
    console.log(`
rudi integrate - Wire RUDI stacks into agent configs

USAGE
  rudi integrate <agent>     Integrate with specific agent
  rudi integrate all         Integrate with all detected agents
  rudi integrate --list      Show detected agents

AGENTS
  claude       Claude Desktop + Claude Code
  cursor       Cursor IDE
  windsurf     Windsurf IDE
  vscode       VS Code / GitHub Copilot
  gemini       Gemini CLI
  codex        OpenAI Codex CLI
  zed          Zed Editor

OPTIONS
  --verbose    Show detailed output
  --dry-run    Show what would be done without making changes

EXAMPLES
  rudi integrate claude
  rudi integrate all
`);
    return;
  }

  // List detected agents
  if (flags.list || target === 'list') {
    const installed = getInstalledAgents();
    console.log('\nDetected agents:');
    for (const agent of installed) {
      console.log(`  ✓ ${agent.name}`);
      console.log(`    ${agent.configFile}`);
    }
    if (installed.length === 0) {
      console.log('  (none detected)');
    }
    return;
  }

  // Get installed stacks
  const stacks = getInstalledStacks();
  if (stacks.length === 0) {
    console.log('No stacks installed. Install with: rudi install <stack>');
    return;
  }

  console.log(`\nIntegrating ${stacks.length} stack(s)...`);

  // Ensure shim exists
  const shimResult = ensureShim();
  if (shimResult.created) {
    console.log(`Created shim: ${shimResult.path}`);
  }

  // Determine which agents to integrate
  let targetAgents = [];

  if (target === 'all') {
    targetAgents = getInstalledAgents().map(a => a.id);
    if (targetAgents.length === 0) {
      console.log('No agents detected.');
      return;
    }
  } else if (target === 'claude') {
    // Both Claude Desktop and Claude Code
    targetAgents = ['claude-desktop', 'claude-code'].filter(id => {
      const agent = AGENT_CONFIGS.find(a => a.id === id);
      return agent && findAgentConfig(agent);
    });
    // If neither exists, try to create claude-code
    if (targetAgents.length === 0) {
      targetAgents = ['claude-code'];
    }
  } else {
    // Map short names to IDs
    const idMap = {
      'cursor': 'cursor',
      'windsurf': 'windsurf',
      'vscode': 'vscode',
      'gemini': 'gemini',
      'codex': 'codex',
      'zed': 'zed',
      'cline': 'cline',
    };
    const agentId = idMap[target] || target;
    targetAgents = [agentId];
  }

  // Dry run
  if (flags['dry-run']) {
    console.log('\nDry run - would integrate:');
    for (const agentId of targetAgents) {
      const agent = AGENT_CONFIGS.find(a => a.id === agentId);
      console.log(`  ${agent?.name || agentId}:`);
      for (const stack of stacks) {
        console.log(`    - ${stack}`);
      }
    }
    return;
  }

  // Integrate each agent
  const results = [];
  for (const agentId of targetAgents) {
    const result = await integrateAgent(agentId, stacks, flags);
    results.push({ agent: agentId, ...result });
  }

  // Summary
  const successful = results.filter(r => r.success);
  console.log(`\n✓ Integrated with ${successful.length} agent(s)`);
  console.log('\nRestart your agent(s) to use the new stacks.');
}
