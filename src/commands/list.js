/**
 * List command - list installed packages
 *
 * Usage:
 *   pstack list [kind]              List all or filter by kind
 *   pstack list prompts             List prompts
 *   pstack list prompts --category=coding   Filter by category
 *   pstack list --json              Output as JSON
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
    let packages = await listInstalled(kind);

    // Filter by category (only for prompts)
    const categoryFilter = flags.category;
    if (categoryFilter) {
      packages = packages.filter(p => p.category === categoryFilter);
    }

    if (flags.json) {
      console.log(JSON.stringify(packages, null, 2));
      return;
    }

    if (packages.length === 0) {
      if (categoryFilter) {
        console.log(`No ${kind || 'packages'}s found in category: ${categoryFilter}`);
      } else if (kind) {
        console.log(`No ${kind}s installed.`);
      } else {
        console.log('No packages installed.');
      }
      console.log(`\nInstall with: pstack install <package>`);
      return;
    }

    // For prompts, group by category if showing all prompts
    if (kind === 'prompt' && !categoryFilter) {
      const byCategory = {};
      for (const pkg of packages) {
        const cat = pkg.category || 'general';
        if (!byCategory[cat]) byCategory[cat] = [];
        byCategory[cat].push(pkg);
      }

      console.log(`\nPROMPTS (${packages.length}):`);
      console.log('─'.repeat(50));

      for (const [category, prompts] of Object.entries(byCategory).sort()) {
        console.log(`\n  ${category.toUpperCase()} (${prompts.length}):`);
        for (const pkg of prompts) {
          const icon = pkg.icon ? `${pkg.icon} ` : '';
          console.log(`    ${icon}${pkg.id || `prompt:${pkg.name}`}`);
          if (pkg.description) {
            console.log(`      ${pkg.description}`);
          }
          if (pkg.tags && pkg.tags.length > 0) {
            console.log(`      Tags: ${pkg.tags.join(', ')}`);
          }
        }
      }

      console.log(`\nTotal: ${packages.length} prompt(s)`);
      console.log(`\nFilter by category: pstack list prompts --category=coding`);
      return;
    }

    // Group by kind (standard display)
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
        const icon = pkg.icon ? `${pkg.icon} ` : '';
        console.log(`  ${icon}${pkg.id || `${pkgKind}:${pkg.name}`}`);
        console.log(`    Version: ${pkg.version || 'unknown'}`);
        if (pkg.description) {
          console.log(`    ${pkg.description}`);
        }
        if (pkg.category) {
          console.log(`    Category: ${pkg.category}`);
        }
        if (pkg.tags && pkg.tags.length > 0) {
          console.log(`    Tags: ${pkg.tags.join(', ')}`);
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
