/**
 * Import command - import sessions from AI agent providers
 *
 * Imports conversation history from Claude Code, Codex, and Gemini
 * into the RUDI database for unified session management.
 */

import { execSync } from 'child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import {
  getDb,
  isDatabaseInitialized,
  initSchema,
  getDbPath
} from '@learnrudi/db';

// Provider configurations
const PROVIDERS = {
  claude: {
    name: 'Claude Code',
    baseDir: join(homedir(), '.claude', 'projects'),
    pattern: /\.jsonl$/,
  },
  codex: {
    name: 'Codex',
    baseDir: join(homedir(), '.codex', 'sessions'),
    pattern: /\.jsonl$/,
  },
  gemini: {
    name: 'Gemini',
    baseDir: join(homedir(), '.gemini', 'sessions'),
    pattern: /\.jsonl$/,
  }
};

export async function cmdImport(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'sessions':
      await importSessions(args.slice(1), flags);
      break;

    case 'status':
      showImportStatus(flags);
      break;

    default:
      console.log(`
rudi import - Import data from AI agent providers

COMMANDS
  sessions [provider]  Import sessions from provider (claude, codex, gemini, or all)
  status               Show import status for all providers

OPTIONS
  --dry-run            Show what would be imported without making changes
  --max-age=DAYS       Only import sessions newer than N days
  --verbose            Show detailed progress

EXAMPLES
  rudi import sessions              # Import from all providers
  rudi import sessions claude       # Import only Claude sessions
  rudi import sessions --dry-run    # Preview without importing
  rudi import status                # Check what's available to import
`);
  }
}

async function importSessions(args, flags) {
  const providerArg = args[0] || 'all';
  const dryRun = flags['dry-run'] || flags.dryRun;
  const verbose = flags.verbose;
  const maxAgeDays = flags['max-age'] ? parseInt(flags['max-age']) : null;

  // Ensure database is initialized
  if (!isDatabaseInitialized()) {
    console.log('Initializing database...');
    initSchema();
  }

  const db = getDb();
  const providers = providerArg === 'all'
    ? Object.keys(PROVIDERS)
    : [providerArg];

  // Validate providers
  for (const p of providers) {
    if (!PROVIDERS[p]) {
      console.error(`Unknown provider: ${p}`);
      console.error(`Available: ${Object.keys(PROVIDERS).join(', ')}`);
      process.exit(1);
    }
  }

  console.log('═'.repeat(60));
  console.log('RUDI Session Import');
  console.log('═'.repeat(60));
  console.log(`Providers:  ${providers.join(', ')}`);
  console.log(`Database:   ${getDbPath()}`);
  console.log(`Max age:    ${maxAgeDays ? `${maxAgeDays} days` : 'all'}`);
  console.log(`Dry run:    ${dryRun ? 'yes' : 'no'}`);
  console.log('═'.repeat(60));

  let totalImported = 0;
  let totalSkipped = 0;

  for (const providerKey of providers) {
    const provider = PROVIDERS[providerKey];
    console.log(`\n▶ ${provider.name}`);
    console.log(`  Source: ${provider.baseDir}`);

    if (!existsSync(provider.baseDir)) {
      console.log(`  ⚠ Directory not found, skipping`);
      continue;
    }

    // Get existing session IDs for this provider
    const existingIds = new Set();
    try {
      const rows = db.prepare(
        'SELECT provider_session_id FROM sessions WHERE provider = ? AND provider_session_id IS NOT NULL'
      ).all(providerKey);
      for (const row of rows) {
        existingIds.add(row.provider_session_id);
      }
    } catch (e) {
      // Table might not exist yet
    }
    console.log(`  Existing: ${existingIds.size} sessions`);

    // Find all session files
    const files = findSessionFiles(provider.baseDir, provider.pattern);
    console.log(`  Found: ${files.length} session files`);

    // Prepare insert statement
    const insertStmt = db.prepare(`
      INSERT INTO sessions (
        id, provider, provider_session_id, project_id,
        origin, origin_imported_at, origin_native_file,
        title, snippet, status, model,
        inherit_project_prompt,
        cwd, dir_scope, native_storage_path,
        created_at, last_active_at,
        turn_count, total_cost, total_input_tokens, total_output_tokens, total_duration_ms,
        is_warmup, parent_session_id, agent_id, is_sidechain, session_type, version, user_type
      ) VALUES (
        ?, ?, ?, NULL,
        'provider-import', ?, ?,
        ?, '', 'active', ?,
        1,
        ?, 'project', ?,
        ?, ?,
        0, 0, 0, 0, 0,
        0, ?, ?, ?, ?, '2.0.76', 'external'
      )
    `);

    let imported = 0;
    let skipped = { existing: 0, empty: 0, old: 0, error: 0 };
    const now = Date.now();
    const maxAgeMs = maxAgeDays ? maxAgeDays * 24 * 60 * 60 * 1000 : null;

    for (const filepath of files) {
      const sessionId = basename(filepath, '.jsonl');

      // Skip existing
      if (existingIds.has(sessionId)) {
        skipped.existing++;
        continue;
      }

      // Check file
      let stat;
      try {
        stat = statSync(filepath);
      } catch (e) {
        skipped.error++;
        continue;
      }

      // Skip empty files
      if (stat.size === 0) {
        skipped.empty++;
        continue;
      }

      // Skip old files
      if (maxAgeMs && (now - stat.mtimeMs) > maxAgeMs) {
        skipped.old++;
        continue;
      }

      // Parse session metadata
      const session = parseSessionFile(filepath, providerKey);
      if (!session) {
        skipped.error++;
        continue;
      }

      if (dryRun) {
        if (verbose || imported < 5) {
          console.log(`  [would import] ${sessionId}: ${session.title.slice(0, 40)}`);
        }
        imported++;
        continue;
      }

      // Insert into database
      try {
        const nowIso = new Date().toISOString();
        insertStmt.run(
          randomUUID(),
          providerKey,
          sessionId,
          nowIso,
          filepath,
          session.title,
          session.model || 'unknown',
          session.cwd,
          filepath,
          session.createdAt,
          session.lastActiveAt,
          session.parentSessionId,
          session.agentId,
          session.isAgent ? 1 : 0,
          session.sessionType
        );
        imported++;

        if (verbose) {
          console.log(`  ✓ ${sessionId}: ${session.title.slice(0, 40)}`);
        } else if (imported % 100 === 0) {
          console.log(`  Imported ${imported}...`);
        }
      } catch (e) {
        skipped.error++;
        if (verbose) {
          console.log(`  ✗ ${sessionId}: ${e.message}`);
        }
      }
    }

    console.log(`  ─────────────────────────────`);
    console.log(`  Imported: ${imported}`);
    console.log(`  Skipped:  ${skipped.existing} existing, ${skipped.empty} empty, ${skipped.old} old, ${skipped.error} errors`);

    totalImported += imported;
    totalSkipped += skipped.existing + skipped.empty + skipped.old + skipped.error;
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`Total imported: ${totalImported}`);
  console.log(`Total skipped:  ${totalSkipped}`);
  console.log('═'.repeat(60));

  if (dryRun) {
    console.log('\n(Dry run - no changes made)');
  }

  // Show final count
  if (!dryRun && totalImported > 0) {
    const count = db.prepare('SELECT COUNT(*) as count FROM sessions').get();
    console.log(`\nTotal sessions in database: ${count.count}`);
  }
}

function showImportStatus(flags) {
  console.log('═'.repeat(60));
  console.log('Import Status');
  console.log('═'.repeat(60));

  // Check database
  if (!isDatabaseInitialized()) {
    console.log('\nDatabase: Not initialized');
    console.log('Run: rudi db init');
  } else {
    const db = getDb();
    const stats = db.prepare(`
      SELECT provider, COUNT(*) as count
      FROM sessions
      WHERE status = 'active'
      GROUP BY provider
    `).all();

    console.log('\nDatabase sessions:');
    for (const row of stats) {
      console.log(`  ${row.provider}: ${row.count}`);
    }
  }

  // Check providers
  console.log('\nProvider directories:');
  for (const [key, provider] of Object.entries(PROVIDERS)) {
    const exists = existsSync(provider.baseDir);
    let count = 0;
    if (exists) {
      const files = findSessionFiles(provider.baseDir, provider.pattern);
      count = files.length;
    }
    console.log(`  ${provider.name}:`);
    console.log(`    Path: ${provider.baseDir}`);
    console.log(`    Status: ${exists ? `${count} session files` : 'not found'}`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log('To import: rudi import sessions [provider]');
}

function findSessionFiles(dir, pattern, files = []) {
  if (!existsSync(dir)) return files;

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        findSessionFiles(fullPath, pattern, files);
      } else if (pattern.test(entry.name)) {
        files.push(fullPath);
      }
    }
  } catch (e) {
    // Skip unreadable directories
  }
  return files;
}

function parseSessionFile(filepath, provider) {
  try {
    const stat = statSync(filepath);
    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split('\n').filter(l => l.trim());

    if (lines.length === 0) return null;

    const sessionId = basename(filepath, '.jsonl');
    const isAgent = sessionId.startsWith('agent-');

    let title = null;
    let cwd = null;
    let createdAt = null;
    let model = null;
    let parentSessionId = null;
    let agentId = isAgent ? sessionId.replace('agent-', '') : null;

    // Parse lines to extract metadata
    for (const line of lines.slice(0, 50)) { // Only check first 50 lines
      try {
        const data = JSON.parse(line);

        if (!cwd && data.cwd) cwd = data.cwd;
        if (!createdAt && data.timestamp) createdAt = data.timestamp;
        if (!model && data.model) model = data.model;
        if (!parentSessionId && (data.parentSessionId || data.parentUuid)) {
          parentSessionId = data.parentSessionId || data.parentUuid;
        }
        if (!agentId && data.agentId) agentId = data.agentId;

        // Extract title from user message
        if (!title) {
          const msg = data.message?.content || data.userMessage ||
                     (data.type === 'user' ? data.message?.content : null);
          if (msg && msg.length > 2) {
            title = msg.split('\n')[0].slice(0, 50).trim();
          }
        }
      } catch (e) {
        continue;
      }
    }

    // Fallbacks
    if (!title || title.length < 3) {
      title = isAgent ? 'Agent Session' : 'Imported Session';
    }
    if (!cwd) {
      const parentDir = basename(dirname(filepath));
      if (parentDir.startsWith('-')) {
        cwd = parentDir.replace(/-/g, '/').replace(/^\//, '/');
      } else {
        cwd = homedir();
      }
    }

    return {
      title,
      cwd,
      createdAt: createdAt || stat.birthtime.toISOString(),
      lastActiveAt: stat.mtime.toISOString(),
      model,
      isAgent,
      agentId,
      parentSessionId,
      sessionType: isAgent ? 'agent' : 'main',
    };
  } catch (e) {
    return null;
  }
}
