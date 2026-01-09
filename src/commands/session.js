/**
 * Session command - manage RUDI sessions
 */

import { getDb, isDatabaseInitialized } from '@learnrudi/db';
import { formatDuration } from '@learnrudi/utils/args';

// Lazy load embeddings to avoid startup cost
let embeddingsModule = null;
async function getEmbeddings() {
  if (!embeddingsModule) {
    embeddingsModule = await import('@learnrudi/embeddings');
  }
  return embeddingsModule;
}

export async function cmdSession(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      sessionList(flags);
      break;

    case 'show':
      sessionShow(args.slice(1), flags);
      break;

    case 'rename':
      sessionRename(args.slice(1), flags);
      break;

    case 'delete':
      sessionDelete(args.slice(1), flags);
      break;

    case 'tag':
      sessionTag(args.slice(1), flags);
      break;

    case 'move':
      sessionMove(args.slice(1), flags);
      break;

    case 'export':
      sessionExport(args.slice(1), flags);
      break;

    case 'search':
      await sessionSearch(args.slice(1), flags);
      break;

    case 'index':
      await sessionIndex(flags);
      break;

    case 'similar':
      await sessionSimilar(args.slice(1), flags);
      break;

    case 'setup':
      await sessionSetup(flags);
      break;

    default:
      console.log(`
rudi session - Manage RUDI sessions

COMMANDS
  list [--provider] [--project] [--limit]   List sessions with filters
  show <id>                                  Show session details
  rename <id> <title>                        Rename a session
  delete <id> [--force]                      Delete a session
  tag <id> <tags>                            Add tags (comma-separated)
  move <id> --project <name>                 Move session to project
  export <id> [-o file]                      Export session to JSON

SEMANTIC SEARCH
  setup                                      Check/setup embedding providers
  search <query> [--semantic] [--limit]     Search sessions (FTS or semantic)
  index [--embeddings] [--provider X]        Index sessions for semantic search
  similar <id> [--limit]                     Find similar sessions

OPTIONS
  --provider <name>     Filter by provider (claude, codex, gemini)
  --project <name>      Filter by project name
  --limit <n>           Limit results (default: 10)
  --format <fmt>        Output format (table, json, jsonl)
  --force               Skip confirmation prompts
  --semantic            Use semantic search (requires embeddings)
  -o, --output <file>   Output file for export

EXAMPLES
  rudi session list --provider claude --limit 10
  rudi session show 7bfa7be7-337f-42d3-90ac-3c8e48b921cb
  rudi session rename 7bfa7be7... "New Title"
  rudi session delete 7bfa7be7... --force
  rudi session tag 7bfa7be7... "bug,auth,urgent"
  rudi session move 7bfa7be7... --project resonance
  rudi session export 7bfa7be7... -o session.json

  # Semantic search
  rudi session search "authentication bugs" --semantic
  rudi session index --embeddings
  rudi session similar 7bfa7be7...
`);
  }
}

function sessionList(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    console.log('Run: rudi db init');
    return;
  }

  const db = getDb();
  const limit = flags.limit || 20;
  const provider = flags.provider;
  const projectName = flags.project;
  const format = flags.format || 'table';

  let query = `
    SELECT
      s.id,
      s.provider_session_id,
      s.provider,
      s.title,
      s.project_id,
      p.name as project_name,
      s.turn_count,
      s.total_cost,
      s.created_at,
      s.last_active_at
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.deleted_at IS NULL
  `;

  const params = [];

  if (provider) {
    query += ` AND s.provider = ?`;
    params.push(provider);
  }

  if (projectName) {
    query += ` AND p.name LIKE ?`;
    params.push(`%${projectName}%`);
  }

  query += ` ORDER BY s.last_active_at DESC LIMIT ?`;
  params.push(limit);

  const sessions = db.prepare(query).all(...params);

  if (format === 'json') {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (format === 'jsonl') {
    sessions.forEach(s => console.log(JSON.stringify(s)));
    return;
  }

  // Table format
  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  console.log(`\nFound ${sessions.length} session(s):\n`);
  sessions.forEach(s => {
    console.log(`${s.provider_session_id || s.id.substring(0, 8)}`);
    console.log(`  Title: ${s.title || '(untitled)'}`);
    console.log(`  Provider: ${s.provider}`);
    if (s.project_name) {
      console.log(`  Project: ${s.project_name}`);
    }
    console.log(`  Turns: ${s.turn_count}, Cost: $${(s.total_cost || 0).toFixed(4)}`);
    console.log(`  Last active: ${new Date(s.last_active_at).toLocaleString()}`);
    console.log('');
  });
}

function sessionShow(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session show <id>');
    return;
  }

  const db = getDb();
  const session = db.prepare(`
    SELECT
      s.*,
      p.name as project_name
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    WHERE s.id = ? OR s.provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (flags.format === 'json') {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  console.log(`\nSession: ${session.provider_session_id || session.id}`);
  console.log(`  Title: ${session.title || '(untitled)'}`);
  console.log(`  Provider: ${session.provider}`);
  if (session.project_name) {
    console.log(`  Project: ${session.project_name} (${session.project_id})`);
  }
  console.log(`  Model: ${session.model || 'N/A'}`);
  console.log(`  Turns: ${session.turn_count}`);
  console.log(`  Cost: $${(session.total_cost || 0).toFixed(4)}`);
  console.log(`  Tokens: ${session.total_input_tokens || 0} in, ${session.total_output_tokens || 0} out`);
  console.log(`  Created: ${new Date(session.created_at).toLocaleString()}`);
  console.log(`  Last active: ${new Date(session.last_active_at).toLocaleString()}`);
  if (session.cwd) {
    console.log(`  Working directory: ${session.cwd}`);
  }
  console.log('');
}

function sessionRename(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  const newTitle = args.slice(1).join(' ');

  if (!sessionId || !newTitle) {
    console.log('Error: Session ID and title required');
    console.log('Usage: rudi session rename <id> <new title>');
    return;
  }

  const db = getDb();
  const result = db.prepare(`
    UPDATE sessions
    SET title = ?, title_override = ?
    WHERE id = ? OR provider_session_id = ?
  `).run(newTitle, newTitle, sessionId, sessionId);

  if (result.changes === 0) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  console.log(`✓ Renamed session to: "${newTitle}"`);
}

function sessionDelete(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session delete <id> [--force]');
    return;
  }

  const db = getDb();

  // Get session info for confirmation
  const session = db.prepare(`
    SELECT id, title, turn_count
    FROM sessions
    WHERE id = ? OR provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (!flags.force) {
    console.log(`\nThis will delete session: ${session.title || '(untitled)'}`);
    console.log(`  ${session.turn_count} turns will be deleted`);
    console.log(`\nUse --force to confirm deletion`);
    return;
  }

  // Soft delete (set deleted_at)
  db.prepare(`
    UPDATE sessions
    SET deleted_at = datetime('now')
    WHERE id = ?
  `).run(session.id);

  console.log(`✓ Deleted session: ${session.title || session.id}`);
}

function sessionTag(args, flags) {
  console.log('Session tagging not yet implemented');
  console.log('Coming soon: Tag sessions for better organization');
}

function sessionMove(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  const projectName = flags.project;

  if (!sessionId || !projectName) {
    console.log('Error: Session ID and project name required');
    console.log('Usage: rudi session move <id> --project <name>');
    return;
  }

  const db = getDb();

  // Find project
  const project = db.prepare(`
    SELECT id, name FROM projects
    WHERE name LIKE ? AND provider = 'claude'
    LIMIT 1
  `).get(`%${projectName}%`);

  if (!project && projectName !== 'null') {
    console.log(`Project not found: ${projectName}`);
    console.log('\nAvailable projects:');
    const projects = db.prepare('SELECT name FROM projects WHERE provider = "claude"').all();
    projects.forEach(p => console.log(`  - ${p.name}`));
    return;
  }

  const projectId = projectName === 'null' ? null : project.id;

  const result = db.prepare(`
    UPDATE sessions
    SET project_id = ?
    WHERE id = ? OR provider_session_id = ?
  `).run(projectId, sessionId, sessionId);

  if (result.changes === 0) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  if (projectId) {
    console.log(`✓ Moved session to project: ${project.name}`);
  } else {
    console.log(`✓ Removed session from project`);
  }
}

async function sessionExport(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const sessionId = args[0];
  if (!sessionId) {
    console.log('Error: Session ID required');
    console.log('Usage: rudi session export <id> [-o file]');
    return;
  }

  const db = getDb();

  // Get session with turns
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE id = ? OR provider_session_id = ?
  `).get(sessionId, sessionId);

  if (!session) {
    console.log(`Session not found: ${sessionId}`);
    return;
  }

  const turns = db.prepare(`
    SELECT * FROM turns
    WHERE session_id = ?
    ORDER BY turn_number
  `).all(session.id);

  const exportData = {
    session,
    turns,
    exported_at: new Date().toISOString()
  };

  const json = JSON.stringify(exportData, null, 2);

  if (flags.output || flags.o) {
    const fs = await import('fs');
    const outputFile = flags.output || flags.o;
    fs.writeFileSync(outputFile, json);
    console.log(`✓ Exported session to: ${outputFile}`);
  } else {
    console.log(json);
  }
}

// =============================================================================
// SEMANTIC SEARCH COMMANDS
// =============================================================================

/**
 * Search sessions - FTS (default) or semantic (--semantic flag)
 */
async function sessionSearch(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const query = args.join(' ');
  if (!query) {
    console.log('Error: Search query required');
    console.log('Usage: rudi session search <query> [--semantic]');
    return;
  }

  const limit = flags.limit || 10;
  const format = flags.format || 'table';

  // Semantic search with embeddings
  if (flags.semantic) {
    await semanticSearch(query, { limit, format });
    return;
  }

  // Default: FTS search
  ftsSearch(query, { limit, format });
}

/**
 * Full-text search using SQLite FTS5
 */
function ftsSearch(query, options) {
  const { limit, format } = options;
  const db = getDb();

  const results = db.prepare(`
    SELECT
      t.id,
      t.session_id,
      t.user_message,
      t.assistant_response,
      t.ts,
      s.title as session_title,
      s.provider,
      highlight(turns_fts, 0, '>>>', '<<<') as user_highlight,
      highlight(turns_fts, 1, '>>>', '<<<') as assistant_highlight
    FROM turns_fts
    JOIN turns t ON turns_fts.rowid = t.rowid
    JOIN sessions s ON t.session_id = s.id
    WHERE turns_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(query, limit);

  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  if (results.length === 0) {
    console.log(`No results found for: "${query}"`);
    return;
  }

  console.log(`\nFound ${results.length} result(s) for "${query}":\n`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.session_title || '(untitled)'}`);
    console.log(`   Session: ${r.session_id.substring(0, 8)}... | ${r.provider}`);
    console.log(`   Date: ${new Date(r.ts).toLocaleString()}`);

    // Show snippet with highlights
    const snippet = (r.user_highlight || r.assistant_highlight || '').substring(0, 200);
    if (snippet) {
      console.log(`   "${snippet.replace(/\n/g, ' ')}..."`);
    }
    console.log('');
  });
}

/**
 * Semantic search using embeddings
 */
async function semanticSearch(query, options) {
  const { limit, format } = options;

  try {
    const { createClient, getProvider } = await getEmbeddings();

    // Auto-detect provider (Ollama first, then OpenAI if key exists)
    const { provider, model } = await getProvider('auto');
    console.log(`Using ${provider.id} with ${model.name}`);

    const client = createClient({ provider, model });

    // Check if we have embeddings
    const stats = client.getStats();
    if (stats.done === 0) {
      console.log('No embeddings found. Run first:');
      console.log('  rudi session index --embeddings');
      return;
    }

    console.log(`Searching ${stats.done} indexed turns...`);
    const results = await client.search(query, { limit });

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log(`No similar results found for: "${query}"`);
      return;
    }

    console.log(`\nTop ${results.length} results for "${query}":\n`);
    results.forEach((r, i) => {
      const similarity = (r.score * 100).toFixed(1);
      console.log(`${i + 1}. [${similarity}%] ${r.turn.session_title || '(untitled)'}`);
      console.log(`   Session: ${r.turn.session_id.substring(0, 8)}... | ${r.turn.provider}`);
      console.log(`   Date: ${new Date(r.turn.ts).toLocaleString()}`);

      // Show snippet
      const content = r.turn.user_message || r.turn.assistant_response || '';
      const snippet = content.substring(0, 200).replace(/\n/g, ' ');
      if (snippet) {
        console.log(`   "${snippet}..."`);
      }
      console.log('');
    });
  } catch (err) {
    console.error('Semantic search error:', err.message);
    if (err.message.includes('not yet implemented')) {
      console.log('\nFor now, use FTS search (without --semantic flag)');
    }
  }
}

/**
 * Index sessions for semantic search
 */
async function sessionIndex(flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const providerName = flags.provider || 'auto';

  if (!flags.embeddings) {
    // Show status
    try {
      const { createClient, getProvider, store } = await getEmbeddings();

      // For status, just check what's in the DB (don't need a provider)
      const model = { name: 'text-embedding-3-small', dimensions: 1536 }; // Check OpenAI model
      const stats = store.getEmbeddingStats(model);
      const pct = stats.total > 0 ? ((stats.done / stats.total) * 100).toFixed(1) : 0;

      console.log('\nEmbedding Index Status:');
      console.log(`  Total turns: ${stats.total}`);
      console.log(`  Indexed: ${stats.done} (${pct}%)`);
      console.log(`  Queued: ${stats.queued}`);
      console.log(`  Errors: ${stats.error}`);
      console.log('\nTo index missing turns:');
      console.log('  rudi session index --embeddings');
      console.log('  rudi session index --embeddings --provider ollama');
    } catch (err) {
      console.log('Embedding status unavailable:', err.message);
    }
    return;
  }

  console.log('Indexing sessions for semantic search...\n');

  try {
    const { createClient, getProvider } = await getEmbeddings();

    // Auto-detect or use specified provider
    const { provider, model } = await getProvider(providerName);
    console.log(`Provider: ${provider.id}`);
    console.log(`Model: ${model.name} (${model.dimensions}d)\n`);

    const client = createClient({ provider, model });

    const stats = client.getStats();
    const missing = stats.total - stats.done - stats.error;

    if (missing === 0) {
      console.log('All turns already indexed!');
      console.log(`  Total: ${stats.total}, Indexed: ${stats.done}, Errors: ${stats.error}`);
      return;
    }

    console.log(`Turns to index: ${missing}`);
    if (provider.id === 'openai') {
      console.log(`Estimated cost: $${((missing * 500 * 0.02) / 1_000_000).toFixed(4)}`);
    } else {
      console.log(`Cost: Free (local)`);
    }
    console.log('');

    let lastProgress = 0;
    const result = await client.indexMissing({
      batchSize: 64,
      onProgress: ({ indexed, errors }) => {
        const now = Date.now();
        if (now - lastProgress > 500) { // Update every 500ms
          process.stdout.write(`\rIndexed: ${indexed} | Errors: ${errors}`);
          lastProgress = now;
        }
      },
    });

    console.log(`\n\n✓ Indexed ${result.indexed} turns`);
    if (result.errors > 0) {
      console.log(`  ${result.errors} errors (retry with: rudi session index --retry-errors)`);
    }

    const newStats = client.getStats();
    console.log(`\nIndex status: ${newStats.done}/${newStats.total} (${((newStats.done / newStats.total) * 100).toFixed(1)}%)`);
  } catch (err) {
    console.error('\nIndexing error:', err.message);
    if (err.code === 'insufficient_quota') {
      console.log('OpenAI quota exceeded. Check your billing at: https://platform.openai.com/usage');
    }
  }
}

/**
 * Find sessions similar to a given session/turn
 */
async function sessionSimilar(args, flags) {
  if (!isDatabaseInitialized()) {
    console.log('Database not initialized.');
    return;
  }

  const turnId = args[0];
  if (!turnId) {
    console.log('Error: Turn or session ID required');
    console.log('Usage: rudi session similar <id> [--limit 10]');
    return;
  }

  const limit = flags.limit || 10;
  const format = flags.format || 'table';
  const providerName = flags.provider || 'auto';

  try {
    const { createClient, getProvider } = await getEmbeddings();

    const { provider, model } = await getProvider(providerName);
    const client = createClient({ provider, model });

    const results = await client.findSimilar(turnId, { limit });

    if (format === 'json') {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    if (results.length === 0) {
      console.log('No similar turns found.');
      console.log('Make sure the turn exists and has been indexed.');
      return;
    }

    console.log(`\nTurns similar to ${turnId.substring(0, 8)}...:\n`);
    results.forEach((r, i) => {
      const similarity = (r.score * 100).toFixed(1);
      console.log(`${i + 1}. [${similarity}%] ${r.turn.session_title || '(untitled)'}`);
      console.log(`   Session: ${r.turn.session_id.substring(0, 8)}...`);
      console.log(`   Date: ${new Date(r.turn.ts).toLocaleString()}`);

      const content = r.turn.user_message || r.turn.assistant_response || '';
      const snippet = content.substring(0, 150).replace(/\n/g, ' ');
      if (snippet) {
        console.log(`   "${snippet}..."`);
      }
      console.log('');
    });
  } catch (err) {
    console.error('Similarity search error:', err.message);
  }
}

/**
 * Setup embedding providers
 */
async function sessionSetup(flags) {
  try {
    const { getSetupInstructions, autoSetupOllama } = await getEmbeddings();

    if (flags.auto) {
      // Try to auto-setup Ollama
      console.log('Auto-configuring embedding provider...\n');
      const result = await autoSetupOllama();
      console.log(result.message);
      if (!result.success) {
        console.log('\nManual setup:');
        console.log(await getSetupInstructions());
      }
      return;
    }

    // Show status and instructions
    console.log(await getSetupInstructions());
  } catch (err) {
    console.error('Setup error:', err.message);
  }
}
