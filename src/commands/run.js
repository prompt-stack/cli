/**
 * Run command - execute a stack
 */

import { isPackageInstalled, getPackagePath } from '@learnrudi/core';
import { runStack, checkSecrets } from '@learnrudi/runner';
import { parseStackManifest, findStackManifest } from '@learnrudi/manifest';
import fs from 'fs';
import path from 'path';

export async function cmdRun(args, flags) {
  const stackId = args[0];

  if (!stackId) {
    console.error('Usage: rudi run <stack> [options]');
    console.error('Example: rudi run pdf-creator');
    process.exit(1);
  }

  // Normalize ID
  const fullId = stackId.includes(':') ? stackId : `stack:${stackId}`;

  // Check if installed
  if (!isPackageInstalled(fullId)) {
    console.error(`Stack not installed: ${stackId}`);
    console.error(`Install with: rudi install ${stackId}`);
    process.exit(1);
  }

  const packagePath = getPackagePath(fullId);

  // Read manifest
  let manifest;
  try {
    const manifestPath = findStackManifest(packagePath);
    if (manifestPath) {
      manifest = parseStackManifest(manifestPath);
    } else {
      // Try manifest.json (our format)
      const jsonPath = path.join(packagePath, 'manifest.json');
      if (fs.existsSync(jsonPath)) {
        manifest = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      }
    }
  } catch (error) {
    console.error(`Failed to read manifest: ${error.message}`);
    process.exit(1);
  }

  if (!manifest) {
    console.error(`No manifest found for ${stackId}`);
    process.exit(1);
  }

  console.log(`Running: ${manifest.name || stackId}`);

  // Check secrets
  const requiredSecrets = manifest.requires?.secrets || [];
  if (requiredSecrets.length > 0) {
    const { satisfied, missing } = checkSecrets(requiredSecrets);
    if (!satisfied) {
      console.error(`\nMissing required secrets:`);
      for (const name of missing) {
        console.error(`  - ${name}`);
      }
      console.error(`\nSet with: rudi secrets set <name>`);
      process.exit(1);
    }
  }

  // Parse inputs
  let inputs = {};
  if (flags.input) {
    try {
      inputs = JSON.parse(flags.input);
    } catch {
      console.error('Invalid --input JSON');
      process.exit(1);
    }
  }

  // Run the stack
  const startTime = Date.now();

  try {
    const result = await runStack(fullId, {
      inputs,
      cwd: flags.cwd || process.cwd(),
      onStdout: (data) => process.stdout.write(data),
      onStderr: (data) => process.stderr.write(data)
    });

    const duration = Date.now() - startTime;

    console.log();
    if (result.exitCode === 0) {
      console.log(`✓ Completed in ${formatDuration(duration)}`);
    } else {
      console.log(`✗ Exited with code ${result.exitCode}`);
      process.exit(result.exitCode);
    }

  } catch (error) {
    console.error(`\nRun failed: ${error.message}`);
    if (flags.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}
