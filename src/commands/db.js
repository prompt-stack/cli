/**
 * Database command - database operations
 */

import {
  getDb,
  initSchema,
  isDatabaseInitialized,
  getDbPath,
  getDbSize,
  getStats,
  search
} from '@prompt-stack/runner/db';
import { formatBytes, formatDuration } from '../utils/args.js';

export async function cmdDb(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'stats':
      dbStats(flags);
      break;

    case 'search':
      dbSearch(args.slice(1), flags);
      break;

    case 'init':
      dbInit(flags);
      break;

    case 'path':
      console.log(getDbPath());
      break;

    default:
      console.log(`
pstack db - Database operations

COMMANDS
  stats              Show usage statistics
  search <query>     Search conversation history
  init               Initialize or migrate database
  path               Show database file path

EXAMPLES
  pstack db stats
  pstack db search "authentication bug"
  pstack db init
`);
  }
}

function dbStats(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    console.log('Run: pstack db init');
    return;
  }

  try {
    const stats = getStats();

    if (flags.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    console.log('\nDatabase Statistics');
    console.log('═'.repeat(50));

    // Overview
    console.log('\nOVERVIEW');
    console.log('─'.repeat(30));
    console.log(`  Total Sessions:     ${stats.totalSessions}`);
    console.log(`  Total Turns:        ${stats.totalTurns}`);
    console.log(`  Total Cost:         $${(stats.totalCost || 0).toFixed(4)}`);
    console.log(`  Total Tokens:       ${formatNumber(stats.totalInputTokens + stats.totalOutputTokens)}`);

    if (stats.totalDurationMs > 0) {
      console.log(`  Total Time:         ${formatDuration(stats.totalDurationMs)}`);
    }

    // By provider
    if (Object.keys(stats.byProvider).length > 0) {
      console.log('\nBY PROVIDER');
      console.log('─'.repeat(30));

      for (const [provider, data] of Object.entries(stats.byProvider)) {
        console.log(`  ${provider}:`);
        console.log(`    Sessions: ${data.sessions}, Turns: ${data.turns}, Cost: $${(data.cost || 0).toFixed(4)}`);
      }
    }

    // Top models
    if (stats.byModel?.length > 0) {
      console.log('\nTOP MODELS');
      console.log('─'.repeat(30));

      for (const model of stats.byModel.slice(0, 5)) {
        console.log(`  ${model.model || 'unknown'}: ${model.turns} turns, $${(model.cost || 0).toFixed(4)}`);
      }
    }

    // Database info
    const dbSize = getDbSize();
    if (dbSize) {
      console.log('\nDATABASE');
      console.log('─'.repeat(30));
      console.log(`  Size: ${formatBytes(dbSize)}`);
      console.log(`  Path: ${getDbPath()}`);
    }

  } catch (error) {
    console.error(`Failed to get stats: ${error.message}`);
    process.exit(1);
  }
}

function dbSearch(args, flags) {
  const query = args.join(' ');

  if (!query) {
    console.error('Usage: pstack db search <query>');
    process.exit(1);
  }

  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  try {
    const results = search(query, {
      limit: flags.limit ? parseInt(flags.limit) : 20,
      provider: flags.provider
    });

    if (flags.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No results found.');
      return;
    }

    console.log(`\nFound ${results.length} result(s):\n`);

    for (const result of results) {
      console.log(`─`.repeat(60));
      console.log(`Session: ${result.session_title || result.session_id}`);
      console.log(`Turn #${result.turn_number} | ${result.provider} | ${result.ts}`);

      if (result.user_highlighted) {
        console.log(`\nUser: ${truncate(stripHighlight(result.user_highlighted), 200)}`);
      }

      if (result.assistant_highlighted) {
        console.log(`\nAssistant: ${truncate(stripHighlight(result.assistant_highlighted), 200)}`);
      }

      console.log();
    }

  } catch (error) {
    console.error(`Search failed: ${error.message}`);
    process.exit(1);
  }
}

function dbInit(flags) {
  console.log('Initializing database...');

  try {
    const result = initSchema();

    if (result.migrated) {
      console.log(`✓ Migrated from v${result.from} to v${result.version}`);
    } else {
      console.log(`✓ Database at v${result.version}`);
    }

    console.log(`  Path: ${getDbPath()}`);

  } catch (error) {
    console.error(`Failed to initialize: ${error.message}`);
    process.exit(1);
  }
}

function formatNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function truncate(str, len) {
  if (!str) return '';
  if (str.length <= len) return str;
  return str.slice(0, len) + '...';
}

function stripHighlight(str) {
  return str.replace(/>>>/g, '').replace(/<<</g, '');
}
