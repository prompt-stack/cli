/**
 * MCP command - Run an MCP server with secrets injected
 *
 * This is the runtime entry point for all MCP stacks.
 * Agent configs point to the shim, which calls: rudi mcp <stack>
 *
 * Flow:
 * 1. Load stack manifest
 * 2. Detect runtime (node/python) and use bundled runtime from ~/.rudi/runtimes/
 * 3. Load required secrets from secure store
 * 4. Set environment variables
 * 5. Exec the stack's MCP server (replaces this process)
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { PATHS } from '@learnrudi/env';
import { getSecret, getAllSecrets } from '@learnrudi/secrets';

/**
 * Get the bundled runtime binary path
 * @param {string} runtime - 'node' or 'python'
 * @returns {string|null} Path to bundled binary, or null if not found
 */
function getBundledRuntime(runtime) {
  const platform = process.platform;

  if (runtime === 'node') {
    const nodePath = platform === 'win32'
      ? path.join(PATHS.runtimes, 'node', 'node.exe')
      : path.join(PATHS.runtimes, 'node', 'bin', 'node');

    if (fs.existsSync(nodePath)) {
      return nodePath;
    }
  }

  if (runtime === 'python') {
    const pythonPath = platform === 'win32'
      ? path.join(PATHS.runtimes, 'python', 'python.exe')
      : path.join(PATHS.runtimes, 'python', 'bin', 'python3');

    if (fs.existsSync(pythonPath)) {
      return pythonPath;
    }
  }

  return null;
}

/**
 * Get the bundled npx path (for Node stacks using npx)
 */
function getBundledNpx() {
  const platform = process.platform;
  const npxPath = platform === 'win32'
    ? path.join(PATHS.runtimes, 'node', 'npx.cmd')
    : path.join(PATHS.runtimes, 'node', 'bin', 'npx');

  if (fs.existsSync(npxPath)) {
    return npxPath;
  }
  return null;
}

/**
 * Load manifest from stack
 */
function loadManifest(stackPath) {
  const manifestPath = path.join(stackPath, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
}

/**
 * Get required secrets from manifest
 * Handles multiple formats:
 * - New: { requires: { secrets: [...] } }
 * - Alt: { secrets: [...] }
 */
function getRequiredSecrets(manifest) {
  const secrets = manifest?.requires?.secrets || manifest?.secrets || [];
  return secrets.map(s => ({
    name: typeof s === 'string' ? s : (s.name || s.key),
    required: typeof s === 'object' ? s.required !== false : true,
  }));
}

/**
 * Build environment with secrets
 */
async function buildEnv(manifest) {
  const env = { ...process.env };
  const requiredSecrets = getRequiredSecrets(manifest);
  const missing = [];

  for (const secret of requiredSecrets) {
    const value = await getSecret(secret.name);
    if (value) {
      env[secret.name] = value;
    } else if (secret.required) {
      missing.push(secret.name);
    }
  }

  return { env, missing };
}

/**
 * Run MCP server
 */
export async function cmdMcp(args, flags) {
  const stackName = args[0];

  if (!stackName) {
    console.error('Usage: rudi mcp <stack>');
    console.error('');
    console.error('This command is typically called by agent shims, not directly.');
    console.error('');
    console.error('Example: rudi mcp slack');
    process.exit(1);
  }

  const stackPath = path.join(PATHS.stacks, stackName);

  // Check stack exists
  if (!fs.existsSync(stackPath)) {
    console.error(`Stack not found: ${stackName}`);
    console.error(`Expected at: ${stackPath}`);
    console.error('');
    console.error(`Install with: rudi install ${stackName}`);
    process.exit(1);
  }

  // Load manifest
  const manifest = loadManifest(stackPath);
  if (!manifest) {
    console.error(`No manifest.json found in stack: ${stackName}`);
    process.exit(1);
  }

  // Build environment with secrets
  const { env, missing } = await buildEnv(manifest);

  if (missing.length > 0 && !flags.force) {
    console.error(`Missing required secrets for ${stackName}:`);
    for (const name of missing) {
      console.error(`  - ${name}`);
    }
    console.error('');
    console.error(`Set with: rudi secrets set ${missing[0]}`);
    process.exit(1);
  }

  // Get command from manifest - support both formats:
  // New: { command: ["node", "dist/index.js"] }
  // Legacy: { mcp: { command: "npx", args: ["tsx", "src/index.ts"] } }
  let command = manifest.command;

  if (!command || command.length === 0) {
    // Try legacy mcp format
    if (manifest.mcp?.command) {
      const mcpCmd = manifest.mcp.command;
      const mcpArgs = manifest.mcp.args || [];
      command = [mcpCmd, ...mcpArgs];
    }
  }

  if (!command || command.length === 0) {
    console.error(`No command defined in manifest for: ${stackName}`);
    process.exit(1);
  }

  // Get runtime type from manifest
  const runtime = manifest.runtime || manifest.mcp?.runtime || 'node';

  // Resolve command - use bundled runtimes when available
  const resolvedCommand = command.map((part, i) => {
    if (i === 0) {
      // First part is the command itself (node, npx, python, etc.)
      // Replace with bundled runtime if available
      if (part === 'node') {
        const bundledNode = getBundledRuntime('node');
        if (bundledNode) return bundledNode;
      } else if (part === 'npx') {
        const bundledNpx = getBundledNpx();
        if (bundledNpx) return bundledNpx;
      } else if (part === 'python' || part === 'python3') {
        const bundledPython = getBundledRuntime('python');
        if (bundledPython) return bundledPython;
      }
      return part; // Fall back to system command
    }

    // Resolve relative paths for other arguments
    if (part.startsWith('./') || part.startsWith('../') || !path.isAbsolute(part)) {
      const resolved = path.join(stackPath, part);
      if (fs.existsSync(resolved)) {
        return resolved;
      }
    }
    return part;
  });

  const [cmd, ...cmdArgs] = resolvedCommand;

  // Set up environment with bundled runtime paths
  // This ensures npm/npx use the bundled node instead of system node
  const bundledNodeBin = path.join(PATHS.runtimes, 'node', 'bin');
  const bundledPythonBin = path.join(PATHS.runtimes, 'python', 'bin');

  if (fs.existsSync(bundledNodeBin) || fs.existsSync(bundledPythonBin)) {
    const runtimePaths = [];
    if (fs.existsSync(bundledNodeBin)) runtimePaths.push(bundledNodeBin);
    if (fs.existsSync(bundledPythonBin)) runtimePaths.push(bundledPythonBin);
    env.PATH = runtimePaths.join(path.delimiter) + path.delimiter + (env.PATH || '');
  }

  // Debug mode
  if (flags.debug) {
    console.error(`[rudi mcp] Stack: ${stackName}`);
    console.error(`[rudi mcp] Path: ${stackPath}`);
    console.error(`[rudi mcp] Runtime: ${runtime}`);
    console.error(`[rudi mcp] Command: ${cmd} ${cmdArgs.join(' ')}`);
    console.error(`[rudi mcp] Secrets loaded: ${getRequiredSecrets(manifest).length - missing.length}`);
    if (getBundledRuntime(runtime)) {
      console.error(`[rudi mcp] Using bundled ${runtime} runtime`);
    } else {
      console.error(`[rudi mcp] Using system ${runtime} (no bundled runtime found)`);
    }
  }

  // Exec the MCP server (replace this process)
  const child = spawn(cmd, cmdArgs, {
    cwd: stackPath,
    env,
    stdio: 'inherit', // MCP uses stdio for communication
  });

  child.on('error', (err) => {
    console.error(`Failed to start MCP server: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}
