/**
 * Install command - install packages from registry
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { installPackage, resolvePackage } from '@prompt-stack/core';
import { registerMcpAll } from '../utils/mcp-registry.js';

/**
 * Load manifest from installed stack path
 */
async function loadManifest(installPath) {
  const manifestPath = path.join(installPath, 'manifest.json');
  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Create .env file with placeholders from manifest.secrets
 */
async function createEnvFile(installPath, manifest) {
  if (!manifest?.secrets?.length) return null;

  const envPath = path.join(installPath, '.env');

  // Check if .env already exists (don't overwrite user's secrets)
  try {
    await fs.access(envPath);
    console.log(`  .env file already exists, preserving existing secrets`);
    return envPath;
  } catch {
    // File doesn't exist, create it
  }

  const lines = [];
  lines.push('# Environment variables for this stack');
  lines.push('# Fill in your API keys below');
  lines.push('');

  for (const secret of manifest.secrets) {
    const key = typeof secret === 'string' ? secret : secret.key;
    const description = typeof secret === 'object' ? secret.description : null;
    const helpUrl = typeof secret === 'object' ? secret.helpUrl : null;

    if (description) {
      lines.push(`# ${description}`);
    }
    if (helpUrl) {
      lines.push(`# Get yours: ${helpUrl}`);
    }
    lines.push(`${key}=`);
    lines.push('');
  }

  await fs.writeFile(envPath, lines.join('\n'), 'utf-8');
  return envPath;
}

export async function cmdInstall(args, flags) {
  const pkgId = args[0];

  if (!pkgId) {
    console.error('Usage: pstack install <package>');
    console.error('Example: pstack install pdf-creator');
    process.exit(1);
  }

  const force = flags.force || false;

  console.log(`Resolving ${pkgId}...`);

  try {
    // First resolve to show what will be installed
    const resolved = await resolvePackage(pkgId);

    console.log(`\nPackage: ${resolved.name} (${resolved.id})`);
    console.log(`Version: ${resolved.version}`);
    if (resolved.description) {
      console.log(`Description: ${resolved.description}`);
    }

    if (resolved.installed && !force) {
      console.log(`\nAlready installed. Use --force to reinstall.`);
      return;
    }

    // Show dependencies
    if (resolved.dependencies?.length > 0) {
      console.log(`\nDependencies:`);
      for (const dep of resolved.dependencies) {
        const status = dep.installed ? '(installed)' : '(will install)';
        console.log(`  - ${dep.id} ${status}`);
      }
    }

    // Show required secrets
    if (resolved.requires?.secrets?.length > 0) {
      console.log(`\nRequired secrets:`);
      for (const secret of resolved.requires.secrets) {
        const name = typeof secret === 'string' ? secret : secret.name;
        console.log(`  - ${name}`);
      }
    }

    console.log(`\nInstalling...`);

    const result = await installPackage(pkgId, {
      force,
      onProgress: (progress) => {
        if (progress.phase === 'installing') {
          console.log(`  Installing ${progress.package}...`);
        }
      }
    });

    if (result.success) {
      console.log(`\n✓ Installed ${result.id}`);
      console.log(`  Path: ${result.path}`);

      if (result.installed?.length > 0) {
        console.log(`\n  Also installed:`);
        for (const id of result.installed) {
          console.log(`    - ${id}`);
        }
      }

      // For stacks: create .env and register MCP
      if (resolved.kind === 'stack') {
        const manifest = await loadManifest(result.path);
        if (manifest) {
          const stackId = resolved.id.replace(/^stack:/, '');

          // Create .env file with placeholders
          const envPath = await createEnvFile(result.path, manifest);

          // Register MCP in agent configs (Claude, Codex, Gemini)
          await registerMcpAll(stackId, result.path, manifest);

          // Show next steps if secrets are required
          if (manifest.secrets?.length > 0) {
            console.log(`\n⚠️  This stack requires configuration:`);
            console.log(`  Edit: ${envPath}`);
            console.log(`\n  Required secrets:`);
            for (const secret of manifest.secrets) {
              const key = typeof secret === 'string' ? secret : secret.key;
              const label = typeof secret === 'object' ? secret.label : key;
              console.log(`    - ${label} (${key})`);
            }
            console.log(`\n  After adding secrets, run: pstack run ${pkgId}`);
            return;
          }
        }
      }

      console.log(`\nRun with: pstack run ${pkgId}`);
    } else {
      console.error(`\n✗ Installation failed: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`Installation failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}
