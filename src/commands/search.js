/**
 * Search command - search registry for packages
 */

import { searchPackages, listPackages } from '@prompt-stack/core';

export async function cmdSearch(args, flags) {
  const query = args[0];

  // Handle --all flag to list everything
  if (flags.all || flags.a) {
    return listAllPackages(flags);
  }

  if (!query) {
    console.error('Usage: pstack search <query>');
    console.error('       pstack search --all           List all available packages');
    console.error('       pstack search --all --stacks  List all stacks');
    console.error('       pstack search --all --runtimes List all runtimes');
    console.error('Example: pstack search pdf');
    process.exit(1);
  }

  const kind = flags.stacks ? 'stack' : flags.prompts ? 'prompt' : flags.runtimes ? 'runtime' : null;

  console.log(`Searching for "${query}"...`);

  try {
    const results = await searchPackages(query, { kind });

    if (results.length === 0) {
      console.log('No packages found matching your query.');
      return;
    }

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.log(`\nFound ${results.length} package(s):\n`);

    // Group by kind
    const grouped = {
      stack: results.filter(r => r.kind === 'stack'),
      prompt: results.filter(r => r.kind === 'prompt'),
      runtime: results.filter(r => r.kind === 'runtime')
    };

    for (const [kind, packages] of Object.entries(grouped)) {
      if (packages.length === 0) continue;

      console.log(`${kind.toUpperCase()}S:`);
      for (const pkg of packages) {
        const id = pkg.id || `${kind}:${pkg.name}`;
        console.log(`  ${id}`);
        console.log(`    ${pkg.description || 'No description'}`);
        if (pkg.version) {
          console.log(`    v${pkg.version}`);
        }
        console.log();
      }
    }

    console.log(`Install with: pstack install <package-id>`);

  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all available packages from registry
 */
async function listAllPackages(flags) {
  const kind = flags.stacks ? 'stack' : flags.prompts ? 'prompt' : flags.runtimes ? 'runtime' : null;

  console.log(kind ? `Listing all ${kind}s...` : 'Listing all available packages...');

  try {
    const kinds = kind ? [kind] : ['stack', 'prompt', 'runtime'];
    let totalCount = 0;

    for (const k of kinds) {
      const packages = await listPackages(k);

      if (packages.length === 0) continue;

      console.log(`\n${k.toUpperCase()}S (${packages.length}):`);
      console.log('─'.repeat(50));

      for (const pkg of packages) {
        const id = pkg.id || `${k}:${pkg.name}`;
        const runtime = pkg.runtime ? ` [${pkg.runtime.replace('runtime:', '')}]` : '';
        console.log(`  ${id}${runtime}`);
        console.log(`    ${pkg.description || 'No description'}`);
      }

      totalCount += packages.length;
    }

    console.log(`\nTotal: ${totalCount} package(s) available`);
    console.log(`Install with: pstack install <package-id>`);

  } catch (error) {
    console.error(`Failed to list packages: ${error.message}`);
    process.exit(1);
  }
}
