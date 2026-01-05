/**
 * Remove command - uninstall packages
 */

import { uninstallPackage, isPackageInstalled } from '@prompt-stack/core';
import { unregisterMcpAll } from '../utils/mcp-registry.js';

export async function cmdRemove(args, flags) {
  const pkgId = args[0];

  if (!pkgId) {
    console.error('Usage: pstack remove <package>');
    console.error('Example: pstack remove pdf-creator');
    process.exit(1);
  }

  // Normalize ID
  const fullId = pkgId.includes(':') ? pkgId : `stack:${pkgId}`;

  // Check if installed
  if (!isPackageInstalled(fullId)) {
    console.error(`Package not installed: ${pkgId}`);
    process.exit(1);
  }

  // Confirm unless --force
  if (!flags.force && !flags.y) {
    console.log(`This will remove: ${fullId}`);
    console.log(`Run with --force to confirm.`);
    process.exit(0);
  }

  console.log(`Removing ${fullId}...`);

  try {
    const result = await uninstallPackage(fullId);

    if (result.success) {
      // Unregister MCP from agent configs (Claude, Codex, Gemini)
      const stackId = fullId.replace(/^stack:/, '');
      await unregisterMcpAll(stackId);

      console.log(`✓ Removed ${fullId}`);
    } else {
      console.error(`✗ Failed to remove: ${result.error}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`Remove failed: ${error.message}`);
    process.exit(1);
  }
}
