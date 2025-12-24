/**
 * Install command - install packages from registry
 */

import { installPackage, resolvePackage } from '@prompt-stack/core';

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
