/**
 * List command - list installed packages
 */

import { listInstalled } from '@prompt-stack/core';

export async function cmdList(args, flags) {
  let kind = args[0];

  // Normalize kind
  if (kind) {
    // Handle plural forms
    if (kind === 'stacks') kind = 'stack';
    if (kind === 'prompts') kind = 'prompt';
    if (kind === 'runtimes') kind = 'runtime';
    if (kind === 'tools') kind = 'tool';
    if (kind === 'agents') kind = 'agent';

    if (!['stack', 'prompt', 'runtime', 'tool', 'agent'].includes(kind)) {
      console.error(`Invalid kind: ${kind}`);
      console.error(`Valid kinds: stack, prompt, runtime, tool, agent`);
      process.exit(1);
    }
  }

  try {
    const packages = await listInstalled(kind);

    if (flags.json) {
      console.log(JSON.stringify(packages, null, 2));
      return;
    }

    if (packages.length === 0) {
      if (kind) {
        console.log(`No ${kind}s installed.`);
      } else {
        console.log('No packages installed.');
      }
      console.log(`\nInstall with: pstack install <package>`);
      return;
    }

    // Group by kind
    const grouped = {
      stack: packages.filter(p => p.kind === 'stack'),
      prompt: packages.filter(p => p.kind === 'prompt'),
      runtime: packages.filter(p => p.kind === 'runtime'),
      tool: packages.filter(p => p.kind === 'tool'),
      agent: packages.filter(p => p.kind === 'agent')
    };

    let total = 0;

    for (const [pkgKind, pkgs] of Object.entries(grouped)) {
      if (pkgs.length === 0) continue;
      if (kind && kind !== pkgKind) continue;

      console.log(`\n${pkgKind.toUpperCase()}S (${pkgs.length}):`);
      console.log('─'.repeat(50));

      for (const pkg of pkgs) {
        console.log(`  ${pkg.id || `${pkgKind}:${pkg.name}`}`);
        console.log(`    Version: ${pkg.version || 'unknown'}`);
        if (pkg.description) {
          console.log(`    ${pkg.description}`);
        }
        if (pkg.installedAt) {
          console.log(`    Installed: ${new Date(pkg.installedAt).toLocaleDateString()}`);
        }
        total++;
      }
    }

    console.log(`\nTotal: ${total} package(s)`);

  } catch (error) {
    console.error(`Failed to list packages: ${error.message}`);
    process.exit(1);
  }
}
