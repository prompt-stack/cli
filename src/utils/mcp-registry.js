/**
 * MCP Registry - Register/unregister MCP servers in agent configs
 *
 * Agents supported:
 * - Claude: ~/.claude/settings.json (JSON)
 * - Codex: ~/.codex/config.toml (TOML)
 * - Gemini: ~/.gemini/settings.json (JSON)
 *
 * When a stack is installed, register it as an MCP server.
 * When a stack is uninstalled, remove it from agent configs.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const HOME = os.homedir();

// Agent config paths
const AGENT_CONFIGS = {
  claude: path.join(HOME, '.claude', 'settings.json'),
  codex: path.join(HOME, '.codex', 'config.toml'),
  gemini: path.join(HOME, '.gemini', 'settings.json'),
};

// =============================================================================
// JSON Utilities
// =============================================================================

/**
 * Read JSON file safely
 */
async function readJson(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Write JSON file with directory creation
 */
async function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// =============================================================================
// TOML Utilities (for Codex)
// =============================================================================

/**
 * Parse a TOML value (string, number, boolean, array)
 */
function parseTomlValue(value) {
  // String (quoted)
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Array
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];

    // Simple parsing for string arrays
    const items = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';

    for (const char of inner) {
      if ((char === '"' || char === "'") && !inQuote) {
        inQuote = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuote) {
        inQuote = false;
        items.push(current);
        current = '';
      } else if (char === ',' && !inQuote) {
        // Skip
      } else if (inQuote) {
        current += char;
      }
    }

    return items;
  }

  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number
  const num = Number(value);
  if (!isNaN(num)) return num;

  // Default to string
  return value;
}

/**
 * Parse TOML content to object
 */
function parseToml(content) {
  const result = {};
  const lines = content.split('\n');

  let currentTable = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Table header: [section] or [section.subsection]
    const tableMatch = trimmed.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      currentTable = tableMatch[1].split('.');
      // Ensure path exists
      let obj = result;
      for (const key of currentTable) {
        obj[key] = obj[key] || {};
        obj = obj[key];
      }
      continue;
    }

    // Key-value pair
    const kvMatch = trimmed.match(/^([^=]+)=(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim();
      let value = kvMatch[2].trim();

      // Parse value
      const parsed = parseTomlValue(value);

      // Set in current table
      let obj = result;
      for (const tableKey of currentTable) {
        obj = obj[tableKey];
      }
      obj[key] = parsed;
    }
  }

  return result;
}

/**
 * Convert a value to TOML representation
 */
function tomlValue(value) {
  if (typeof value === 'string') {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const items = value.map(v => tomlValue(v));
    return `[${items.join(', ')}]`;
  }
  return String(value);
}

/**
 * Convert config object to TOML string
 */
function stringifyToml(config, prefix = '') {
  const lines = [];

  // First, output simple key-values at this level
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      lines.push(`${key} = ${tomlValue(value)}`);
    }
  }

  // Then, output nested tables
  for (const [key, value] of Object.entries(config)) {
    if (typeof value === 'object' && !Array.isArray(value)) {
      const tablePath = prefix ? `${prefix}.${key}` : key;

      // Check if this table has simple values
      const hasSimpleValues = Object.values(value).some(
        v => typeof v !== 'object' || Array.isArray(v)
      );

      if (hasSimpleValues) {
        lines.push('');
        lines.push(`[${tablePath}]`);
      }

      // Recursively stringify
      const nested = stringifyToml(value, tablePath);
      if (nested.trim()) {
        lines.push(nested);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Read TOML file safely
 */
async function readToml(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseToml(content);
  } catch {
    return {};
  }
}

/**
 * Write TOML file with directory creation
 */
async function writeToml(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, stringifyToml(data), 'utf-8');
}

// =============================================================================
// .env Utilities
// =============================================================================

/**
 * Parse .env file content to object
 */
function parseEnvFile(content) {
  const env = {};
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Only include if value is not empty
    if (value) {
      env[key] = value;
    }
  }

  return env;
}

/**
 * Read secrets from stack's .env file
 */
async function readStackEnv(installPath) {
  const envPath = path.join(installPath, '.env');
  try {
    const content = await fs.readFile(envPath, 'utf-8');
    return parseEnvFile(content);
  } catch {
    return {};
  }
}

// =============================================================================
// MCP Config Builder
// =============================================================================

/**
 * Build MCP config from manifest
 */
async function buildMcpConfig(stackId, installPath, manifest) {
  // Check if this is an MCP stack
  // Pattern 1: manifest.mcp object (explicit MCP config)
  // Pattern 2: manifest.command array (legacy format)

  let command;
  let args = [];
  const cwd = installPath;

  // Pattern 1: Explicit MCP config (preferred)
  if (manifest.mcp) {
    command = manifest.mcp.command;
    args = manifest.mcp.args || [];
    // Resolve relative paths
    if (manifest.mcp.entry) {
      args = args.map(arg =>
        arg === manifest.mcp.entry ? path.join(installPath, manifest.mcp.entry) : arg
      );
    }
  }
  // Pattern 2: Command array (legacy)
  else if (manifest.command) {
    const cmdArray = manifest.command;
    command = cmdArray[0];
    args = cmdArray.slice(1).map(arg =>
      // Resolve relative paths like "dist/index.js"
      arg.includes('/') ? path.join(installPath, arg) : arg
    );
  }
  // Not an MCP stack
  else {
    return null;
  }

  // Build environment with secrets from stack's .env file
  const env = await readStackEnv(installPath);

  const config = {
    command,
    cwd,
  };

  if (args.length > 0) {
    config.args = args;
  }

  if (Object.keys(env).length > 0) {
    config.env = env;
  }

  return config;
}

// =============================================================================
// Claude (JSON)
// =============================================================================

/**
 * Register MCP server in Claude settings
 */
export async function registerMcpClaude(stackId, installPath, manifest) {
  const configPath = AGENT_CONFIGS.claude;

  try {
    const mcpConfig = await buildMcpConfig(stackId, installPath, manifest);
    if (!mcpConfig) {
      // Not an MCP stack, skip silently
      return { success: true, skipped: true };
    }

    // Add type for Claude
    mcpConfig.type = 'stdio';

    const settings = await readJson(configPath);

    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }

    settings.mcpServers[stackId] = mcpConfig;

    await writeJson(configPath, settings);

    console.log(`  Registered MCP in Claude: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to register MCP in Claude: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Unregister MCP server from Claude settings
 */
export async function unregisterMcpClaude(stackId) {
  const configPath = AGENT_CONFIGS.claude;

  try {
    const settings = await readJson(configPath);

    if (!settings.mcpServers || !settings.mcpServers[stackId]) {
      return { success: true, skipped: true };
    }

    delete settings.mcpServers[stackId];

    await writeJson(configPath, settings);

    console.log(`  Unregistered MCP from Claude: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to unregister MCP from Claude: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Codex (TOML)
// =============================================================================

/**
 * Register MCP server in Codex config
 */
export async function registerMcpCodex(stackId, installPath, manifest) {
  const configPath = AGENT_CONFIGS.codex;

  try {
    const mcpConfig = await buildMcpConfig(stackId, installPath, manifest);
    if (!mcpConfig) {
      return { success: true, skipped: true };
    }

    const config = await readToml(configPath);

    if (!config.mcp_servers) {
      config.mcp_servers = {};
    }

    config.mcp_servers[stackId] = mcpConfig;

    await writeToml(configPath, config);

    console.log(`  Registered MCP in Codex: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to register MCP in Codex: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Unregister MCP server from Codex config
 */
export async function unregisterMcpCodex(stackId) {
  const configPath = AGENT_CONFIGS.codex;

  try {
    const config = await readToml(configPath);

    if (!config.mcp_servers || !config.mcp_servers[stackId]) {
      return { success: true, skipped: true };
    }

    delete config.mcp_servers[stackId];

    await writeToml(configPath, config);

    console.log(`  Unregistered MCP from Codex: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to unregister MCP from Codex: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Gemini (JSON)
// =============================================================================

/**
 * Register MCP server in Gemini settings
 */
export async function registerMcpGemini(stackId, installPath, manifest) {
  const configPath = AGENT_CONFIGS.gemini;

  try {
    const mcpConfig = await buildMcpConfig(stackId, installPath, manifest);
    if (!mcpConfig) {
      return { success: true, skipped: true };
    }

    const settings = await readJson(configPath);

    if (!settings.mcpServers) {
      settings.mcpServers = {};
    }

    settings.mcpServers[stackId] = mcpConfig;

    await writeJson(configPath, settings);

    console.log(`  Registered MCP in Gemini: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to register MCP in Gemini: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Unregister MCP server from Gemini settings
 */
export async function unregisterMcpGemini(stackId) {
  const configPath = AGENT_CONFIGS.gemini;

  try {
    const settings = await readJson(configPath);

    if (!settings.mcpServers || !settings.mcpServers[stackId]) {
      return { success: true, skipped: true };
    }

    delete settings.mcpServers[stackId];

    await writeJson(configPath, settings);

    console.log(`  Unregistered MCP from Gemini: ${stackId}`);
    return { success: true };
  } catch (error) {
    console.error(`  Failed to unregister MCP from Gemini: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// =============================================================================
// Combined Operations
// =============================================================================

/**
 * Register MCP in all supported agents
 */
export async function registerMcpAll(stackId, installPath, manifest) {
  const results = {
    claude: await registerMcpClaude(stackId, installPath, manifest),
    codex: await registerMcpCodex(stackId, installPath, manifest),
    gemini: await registerMcpGemini(stackId, installPath, manifest),
  };

  return results;
}

/**
 * Unregister MCP from all supported agents
 */
export async function unregisterMcpAll(stackId) {
  const results = {
    claude: await unregisterMcpClaude(stackId),
    codex: await unregisterMcpCodex(stackId),
    gemini: await unregisterMcpGemini(stackId),
  };

  return results;
}

/**
 * List registered MCPs in Claude
 */
export async function listRegisteredMcps() {
  const configPath = AGENT_CONFIGS.claude;
  const settings = await readJson(configPath);
  return Object.keys(settings.mcpServers || {});
}
