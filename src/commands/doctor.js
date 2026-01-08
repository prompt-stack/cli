/**
 * Doctor command - system health check
 */

import {
  PATHS,
  ensureDirectories,
  getInstalledPackages,
  getAvailableDeps,
  getAllDepsFromRegistry
} from '@learnrudi/core';
import { isDatabaseInitialized, initSchema } from '@learnrudi/db';
import { listSecretNames } from '@learnrudi/runner';
import fs from 'fs';

export async function cmdDoctor(args, flags) {
  console.log('RUDI Health Check');
  console.log('═'.repeat(50));

  const issues = [];
  const fixes = [];

  // Check directories
  console.log('\n📁 Directories');
  const dirs = [
    { path: PATHS.home, name: 'Home' },
    { path: PATHS.stacks, name: 'Stacks' },
    { path: PATHS.prompts, name: 'Prompts' },
    { path: PATHS.runtimes, name: 'Runtimes' },
    { path: PATHS.binaries, name: 'Binaries' },
    { path: PATHS.agents, name: 'Agents' },
    { path: PATHS.db, name: 'Database' },
    { path: PATHS.cache, name: 'Cache' }
  ];

  for (const dir of dirs) {
    const exists = fs.existsSync(dir.path);
    const status = exists ? '✓' : '✗';
    console.log(`  ${status} ${dir.name}: ${dir.path}`);

    if (!exists) {
      issues.push(`Missing directory: ${dir.name}`);
      fixes.push(() => fs.mkdirSync(dir.path, { recursive: true }));
    }
  }

  // Check database
  console.log('\n💾 Database');
  const dbInitialized = isDatabaseInitialized();
  console.log(`  ${dbInitialized ? '✓' : '✗'} Initialized: ${dbInitialized}`);

  if (!dbInitialized) {
    issues.push('Database not initialized');
    fixes.push(() => initSchema());
  }

  // Check installed packages
  console.log('\n📦 Packages');
  try {
    const stacks = getInstalledPackages('stack');
    const prompts = getInstalledPackages('prompt');
    const runtimes = getInstalledPackages('runtime');

    console.log(`  ✓ Stacks: ${stacks.length}`);
    console.log(`  ✓ Prompts: ${prompts.length}`);
    console.log(`  ✓ Runtimes: ${runtimes.length}`);
  } catch (error) {
    console.log(`  ✗ Error reading packages: ${error.message}`);
    issues.push('Cannot read packages');
  }

  // Check secrets
  console.log('\n🔐 Secrets');
  try {
    const secrets = listSecretNames();
    console.log(`  ✓ Configured: ${secrets.length}`);

    if (secrets.length > 0) {
      for (const name of secrets.slice(0, 5)) {
        console.log(`    - ${name}`);
      }
      if (secrets.length > 5) {
        console.log(`    ... and ${secrets.length - 5} more`);
      }
    }
  } catch (error) {
    console.log(`  ✗ Error reading secrets: ${error.message}`);
  }

  // Check runtimes and binaries
  console.log('\n⚙️  Runtimes');
  try {
    // Use registry for --all flag, otherwise just check common/installed
    const { runtimes, binaries } = flags.all
      ? await getAllDepsFromRegistry()
      : getAvailableDeps();

    for (const rt of runtimes) {
      const icon = rt.available ? '✓' : '○';
      const version = rt.version ? `v${rt.version}` : '';
      const source = rt.available
        ? `(${rt.source})`
        : (flags.all ? 'available' : 'not found');
      console.log(`  ${icon} ${rt.name}: ${version} ${source}`);
    }

    console.log('\n🔧 Binaries');
    for (const bin of binaries) {
      const icon = bin.available ? '✓' : '○';
      const version = bin.version ? `v${bin.version}` : '';
      const managed = bin.managed === false ? ' (external)' : '';
      const source = bin.available
        ? `(${bin.source})`
        : (flags.all ? `available${managed}` : 'not found');
      console.log(`  ${icon} ${bin.name}: ${version} ${source}`);
    }

    if (flags.all) {
      const availableRuntimes = runtimes.filter(r => !r.available).length;
      const availableBinaries = binaries.filter(b => !b.available && b.managed !== false).length;
      if (availableRuntimes + availableBinaries > 0) {
        console.log(`\n  Install with: rudi install runtime:<name> or rudi install binary:<name>`);
      }
    }
  } catch (error) {
    console.log(`  ✗ Error checking dependencies: ${error.message}`);
  }

  // Check Node.js version
  console.log('\n📍 Environment');
  const nodeVersion = process.version;
  const nodeOk = parseInt(nodeVersion.slice(1)) >= 18;
  console.log(`  ${nodeOk ? '✓' : '✗'} Node.js: ${nodeVersion} ${nodeOk ? '' : '(requires >=18)'}`);
  console.log(`  ✓ Platform: ${process.platform}-${process.arch}`);
  console.log(`  ✓ RUDI Home: ${PATHS.home}`);

  if (!nodeOk) {
    issues.push('Node.js version too old (requires >=18)');
  }

  // Summary
  console.log('\n' + '─'.repeat(50));

  if (issues.length === 0) {
    console.log('✓ All checks passed!');
  } else {
    console.log(`Found ${issues.length} issue(s):\n`);
    for (const issue of issues) {
      console.log(`  • ${issue}`);
    }

    if (flags.fix && fixes.length > 0) {
      console.log('\nAttempting fixes...');
      for (const fix of fixes) {
        try {
          fix();
        } catch (error) {
          console.error(`  Fix failed: ${error.message}`);
        }
      }
      console.log('Done. Run doctor again to verify.');
    } else if (fixes.length > 0) {
      console.log('\nRun with --fix to attempt automatic fixes.');
    }
  }
}
