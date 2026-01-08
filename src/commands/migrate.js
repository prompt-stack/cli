/**
 * Migrate command - Migrate from .prompt-stack to .rudi
 *
 * Handles:
 * - Copying stacks from ~/.prompt-stack/stacks to ~/.rudi/stacks
 * - Updating agent configs to use new shim pattern
 * - Cleaning up old entries
 */

import * as fs from 'fs';
import * as path from 'path';
import os from 'os';
import { PATHS } from '@learnrudi/env';
import { AGENT_CONFIGS, findAgentConfig } from '@learnrudi/mcp';

const HOME = os.homedir();
const OLD_PROMPT_STACK = path.join(HOME, '.prompt-stack');
const SHIM_PATH = path.join(PATHS.home, 'shims', 'rudi-mcp');

/**
 * Get list of stacks in old .prompt-stack directory
 */
function getOldStacks() {
  const stacksDir = path.join(OLD_PROMPT_STACK, 'stacks');
  if (!fs.existsSync(stacksDir)) return [];

  return fs.readdirSync(stacksDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('.'))
    .filter(d => {
      // Check for manifest.json or package.json
      const hasManifest = fs.existsSync(path.join(stacksDir, d.name, 'manifest.json'));
      const hasPackage = fs.existsSync(path.join(stacksDir, d.name, 'package.json'));
      return hasManifest || hasPackage;
    })
    .map(d => d.name);
}

/**
 * Copy a stack from old location to new
 */
function copyStack(stackName) {
  const oldPath = path.join(OLD_PROMPT_STACK, 'stacks', stackName);
  const newPath = path.join(PATHS.stacks, stackName);

  if (!fs.existsSync(oldPath)) {
    return { success: false, error: 'Source not found' };
  }

  if (fs.existsSync(newPath)) {
    return { success: true, skipped: true, reason: 'Already exists' };
  }

  // Ensure stacks directory exists
  if (!fs.existsSync(PATHS.stacks)) {
    fs.mkdirSync(PATHS.stacks, { recursive: true });
  }

  // Copy recursively
  copyRecursive(oldPath, newPath);

  return { success: true, copied: true };
}

/**
 * Recursive copy helper
 */
function copyRecursive(src, dest) {
  const stat = fs.statSync(src);

  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

/**
 * Ensure the shim exists
 */
function ensureShim() {
  const shimsDir = path.dirname(SHIM_PATH);
  if (!fs.existsSync(shimsDir)) {
    fs.mkdirSync(shimsDir, { recursive: true });
  }

  const shimContent = `#!/usr/bin/env bash
set -euo pipefail
if command -v rudi &> /dev/null; then
  exec rudi mcp "$1"
else
  exec npx --yes @learnrudi/cli mcp "$1"
fi
`;

  fs.writeFileSync(SHIM_PATH, shimContent, { mode: 0o755 });
}

/**
 * Build new MCP entry using shim
 */
function buildNewEntry(stackName, agentId) {
  const base = {
    command: SHIM_PATH,
    args: [stackName],
  };

  if (agentId === 'claude-desktop' || agentId === 'claude-code') {
    return { type: 'stdio', ...base };
  }

  return base;
}

/**
 * Check if an MCP entry is using old .prompt-stack path
 */
function isOldEntry(entry) {
  if (!entry) return false;

  const command = entry.command || '';
  const args = entry.args || [];
  const cwd = entry.cwd || '';

  return command.includes('.prompt-stack') ||
         args.some(a => typeof a === 'string' && a.includes('.prompt-stack')) ||
         cwd.includes('.prompt-stack');
}

/**
 * Migrate an agent's config
 */
function migrateAgentConfig(agentConfig, installedStacks, flags) {
  const configPath = findAgentConfig(agentConfig);
  if (!configPath) return { skipped: true, reason: 'Config not found' };

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    return { skipped: true, reason: 'Could not parse config' };
  }

  const key = agentConfig.key;
  const mcpServers = config[key] || {};

  let updated = 0;
  let removed = 0;
  const changes = [];

  for (const [name, entry] of Object.entries(mcpServers)) {
    if (isOldEntry(entry)) {
      if (installedStacks.includes(name)) {
        // Update to new shim pattern
        const newEntry = buildNewEntry(name, agentConfig.id);
        mcpServers[name] = newEntry;
        updated++;
        changes.push({ name, action: 'updated' });
      } else if (flags.removeOrphans) {
        // Remove orphaned entry (stack not installed)
        delete mcpServers[name];
        removed++;
        changes.push({ name, action: 'removed (not installed)' });
      } else {
        changes.push({ name, action: 'skipped (not installed in .rudi)' });
      }
    }
  }

  if (updated > 0 || removed > 0) {
    // Backup
    const backupPath = configPath + '.backup.' + Date.now();
    fs.copyFileSync(configPath, backupPath);

    // Write updated config
    config[key] = mcpServers;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  return { updated, removed, changes };
}

/**
 * Main migrate command
 */
export async function cmdMigrate(args, flags) {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help') {
    console.log(`
rudi migrate - Migrate from .prompt-stack to .rudi

USAGE
  rudi migrate status         Show what needs to be migrated
  rudi migrate stacks         Copy stacks from .prompt-stack to .rudi
  rudi migrate configs        Update agent configs to use new shim
  rudi migrate all            Do everything

OPTIONS
  --remove-orphans    Remove entries for stacks not installed in .rudi
  --dry-run           Show what would be done without making changes
`);
    return;
  }

  if (subcommand === 'status') {
    await migrateStatus();
    return;
  }

  if (subcommand === 'stacks') {
    await migrateStacks(flags);
    return;
  }

  if (subcommand === 'configs') {
    await migrateConfigs(flags);
    return;
  }

  if (subcommand === 'all') {
    await migrateStacks(flags);
    console.log('');
    await migrateConfigs(flags);
    return;
  }

  console.error(`Unknown subcommand: ${subcommand}`);
  console.error('Run: rudi migrate help');
}

/**
 * Show migration status
 */
async function migrateStatus() {
  console.log('\n=== Migration Status ===\n');

  // Check old stacks
  const oldStacks = getOldStacks();
  console.log(`Old .prompt-stack stacks: ${oldStacks.length}`);
  if (oldStacks.length > 0) {
    for (const name of oldStacks) {
      const existsInRudi = fs.existsSync(path.join(PATHS.stacks, name));
      const status = existsInRudi ? '✓ (already in .rudi)' : '○ (needs migration)';
      console.log(`  ${status} ${name}`);
    }
  }

  // Check new stacks
  const newStacksDir = PATHS.stacks;
  let newStacks = [];
  if (fs.existsSync(newStacksDir)) {
    newStacks = fs.readdirSync(newStacksDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
  }
  console.log(`\nNew .rudi stacks: ${newStacks.length}`);
  if (newStacks.length > 0) {
    for (const name of newStacks) {
      console.log(`  ✓ ${name}`);
    }
  }

  // Check agent configs for old entries
  console.log('\n=== Agent Configs ===\n');

  for (const agentConfig of AGENT_CONFIGS) {
    const configPath = findAgentConfig(agentConfig);
    if (!configPath) continue;

    let config;
    try {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
      continue;
    }

    const mcpServers = config[agentConfig.key] || {};
    const entries = Object.entries(mcpServers);
    const oldEntries = entries.filter(([_, e]) => isOldEntry(e));
    const newEntries = entries.filter(([_, e]) => !isOldEntry(e));

    if (entries.length === 0) continue;

    console.log(`${agentConfig.name}:`);
    console.log(`  Config: ${configPath}`);
    console.log(`  Old entries: ${oldEntries.length}`);
    console.log(`  New entries: ${newEntries.length}`);

    if (oldEntries.length > 0) {
      console.log('  Needs update:');
      for (const [name] of oldEntries) {
        const installed = newStacks.includes(name);
        const status = installed ? '(ready)' : '(not in .rudi)';
        console.log(`    - ${name} ${status}`);
      }
    }
    console.log('');
  }

  console.log('Run: rudi migrate all');
}

/**
 * Migrate stacks from .prompt-stack to .rudi
 */
async function migrateStacks(flags) {
  console.log('=== Migrating Stacks ===\n');

  const oldStacks = getOldStacks();

  if (oldStacks.length === 0) {
    console.log('No stacks found in .prompt-stack');
    return;
  }

  console.log(`Found ${oldStacks.length} stack(s) in .prompt-stack\n`);

  for (const name of oldStacks) {
    if (flags.dryRun) {
      const exists = fs.existsSync(path.join(PATHS.stacks, name));
      console.log(`  [dry-run] ${name}: ${exists ? 'would skip (exists)' : 'would copy'}`);
    } else {
      const result = copyStack(name);
      if (result.skipped) {
        console.log(`  ○ ${name}: skipped (${result.reason})`);
      } else if (result.copied) {
        console.log(`  ✓ ${name}: copied to .rudi/stacks/`);
      } else {
        console.log(`  ✗ ${name}: ${result.error}`);
      }
    }
  }

  if (!flags.dryRun) {
    console.log(`\nStacks migrated to: ${PATHS.stacks}`);
  }
}

/**
 * Migrate agent configs to use new shim pattern
 */
async function migrateConfigs(flags) {
  console.log('=== Updating Agent Configs ===\n');

  // Ensure shim exists
  if (!flags.dryRun) {
    ensureShim();
    console.log(`Shim ready: ${SHIM_PATH}\n`);
  }

  // Get installed stacks in .rudi
  let installedStacks = [];
  if (fs.existsSync(PATHS.stacks)) {
    installedStacks = fs.readdirSync(PATHS.stacks, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
      .map(d => d.name);
  }

  for (const agentConfig of AGENT_CONFIGS) {
    const configPath = findAgentConfig(agentConfig);
    if (!configPath) continue;

    if (flags.dryRun) {
      console.log(`${agentConfig.name}:`);
      console.log(`  [dry-run] Would update entries using .prompt-stack paths`);
      continue;
    }

    const result = migrateAgentConfig(agentConfig, installedStacks, flags);

    if (result.skipped) {
      continue;
    }

    console.log(`${agentConfig.name}:`);
    console.log(`  Config: ${configPath}`);

    if (result.changes && result.changes.length > 0) {
      for (const change of result.changes) {
        console.log(`    ${change.action}: ${change.name}`);
      }
    }

    if (result.updated > 0 || result.removed > 0) {
      console.log(`  Updated: ${result.updated}, Removed: ${result.removed}`);
    } else {
      console.log(`  No changes needed`);
    }
    console.log('');
  }

  console.log('Restart your agents to use the updated configs.');
}
