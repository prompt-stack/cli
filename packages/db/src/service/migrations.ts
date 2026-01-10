/**
 * Database Migrations
 *
 * Handles migration from JSON files to SQLite database.
 */

import * as path from 'path'
import { readFile, rename, access } from 'fs/promises'
import type BetterSqlite3 from 'better-sqlite3'
import { recomputeSessionAggregates } from './turns'

// ============================================================================
// Project Migration (from projects.json)
// ============================================================================

/**
 * Check if projects need to be migrated from JSON to database
 */
export async function needsProjectMigration(db: BetterSqlite3.Database, dbDir: string): Promise<boolean> {
  const projectsJsonPath = path.join(dbDir, 'projects.json')

  try {
    await access(projectsJsonPath)
  } catch {
    return false
  }

  // Check if we already have projects in the database
  const count = db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number }

  if (count.count > 0) {
    // Check if JSON has projects not in database
    try {
      const content = await readFile(projectsJsonPath, 'utf-8')
      const jsonData = JSON.parse(content)
      const jsonProjects = jsonData.projects || []

      for (const proj of jsonProjects) {
        const exists = db.prepare('SELECT 1 FROM projects WHERE id = ?').get(proj.id)
        if (!exists) {
          return true
        }
      }
      return false
    } catch {
      return false
    }
  }

  return true
}

/**
 * Migrate projects from projects.json to database
 * @returns Number of projects migrated
 */
export async function migrateProjectsFromJson(db: BetterSqlite3.Database, dbDir: string): Promise<number> {
  const projectsJsonPath = path.join(dbDir, 'projects.json')

  try {
    await access(projectsJsonPath)
  } catch {
    console.log('[DbMigrations] No projects.json found, skipping migration')
    return 0
  }

  try {
    const content = await readFile(projectsJsonPath, 'utf-8')
    const jsonData = JSON.parse(content)
    const jsonProjects = jsonData.projects || []

    if (jsonProjects.length === 0) {
      console.log('[DbMigrations] No projects in projects.json')
      return 0
    }

    let migrated = 0

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO projects (id, provider, name, color, settings, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const proj of jsonProjects) {
      const result = insertStmt.run(
        proj.id,
        proj.provider || 'claude',
        proj.name,
        proj.color || null,
        proj.settings ? JSON.stringify(proj.settings) : null,
        proj.createdAt || new Date().toISOString()
      )

      if (result.changes > 0) {
        migrated++
      }
    }

    console.log(`[DbMigrations] Migrated ${migrated} projects from JSON to database`)

    // Rename the old file to indicate migration is complete
    if (migrated > 0) {
      const backupPath = projectsJsonPath + '.migrated'
      await rename(projectsJsonPath, backupPath)
      console.log(`[DbMigrations] Renamed projects.json to ${backupPath}`)
    }

    return migrated
  } catch (error) {
    console.error('[DbMigrations] Failed to migrate projects:', error)
    return 0
  }
}

// ============================================================================
// Turns Migration (from turns.jsonl)
// ============================================================================

/**
 * Check if turns need to be migrated from JSONL to database
 */
export async function needsTurnsMigration(dbDir: string): Promise<boolean> {
  const turnsJsonlPath = path.join(dbDir, 'turns.jsonl')

  try {
    const stats = await readFile(turnsJsonlPath, 'utf-8')
    return stats.length > 0
  } catch {
    return false
  }
}

/**
 * Migrate turns from turns.jsonl to database
 * @returns Number of turns migrated
 */
export async function migrateTurnsFromJsonl(db: BetterSqlite3.Database, dbDir: string): Promise<number> {
  const turnsJsonlPath = path.join(dbDir, 'turns.jsonl')

  try {
    await access(turnsJsonlPath)
  } catch {
    console.log('[DbMigrations] No turns.jsonl found, skipping migration')
    return 0
  }

  try {
    const content = await readFile(turnsJsonlPath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)

    if (lines.length === 0) {
      console.log('[DbMigrations] No turns in turns.jsonl')
      return 0
    }

    let migrated = 0
    let skipped = 0
    const sessionsToRecompute = new Set<string>()

    const insertStmt = db.prepare(`
      INSERT OR IGNORE INTO turns (
        id, session_id, provider, provider_session_id, turn_number,
        user_message, assistant_response, thinking,
        model, permission_mode,
        cost, duration_ms, duration_api_ms,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        finish_reason, error, tools_used, ts
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `)

    for (const line of lines) {
      try {
        const turn = JSON.parse(line)

        // Skip if already exists
        const existing = db.prepare('SELECT 1 FROM turns WHERE id = ?').get(turn.id)
        if (existing) {
          skipped++
          continue
        }

        // Validate required session exists
        const sessionExists = db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(turn.sessionId)
        if (!sessionExists) {
          console.warn(`[DbMigrations] Turn ${turn.id} references non-existent session ${turn.sessionId}, skipping`)
          skipped++
          continue
        }

        // Convert error to string if boolean
        const errorValue = typeof turn.error === 'boolean'
          ? (turn.error ? 'true' : null)
          : (turn.error ?? null)

        insertStmt.run(
          turn.id,
          turn.sessionId,
          turn.provider || 'claude',
          turn.providerSessionId ?? turn.claudeSessionId ?? null,
          turn.turnNumber,
          turn.userMessage ?? null,
          null,  // assistant_response not in JSONL format
          null,  // thinking not in JSONL format
          turn.model ?? null,
          turn.permissionMode ?? null,
          turn.cost ?? null,
          turn.durationMs ?? null,
          turn.durationApiMs ?? null,
          turn.inputTokens ?? null,
          turn.outputTokens ?? null,
          turn.cacheReadTokens ?? null,
          turn.cacheCreationTokens ?? null,
          turn.finishReason ?? null,
          errorValue,
          turn.toolsUsed ? JSON.stringify(turn.toolsUsed) : null,
          turn.ts || new Date().toISOString()
        )

        migrated++
        sessionsToRecompute.add(turn.sessionId)
      } catch (parseError) {
        console.warn('[DbMigrations] Failed to parse turn line:', parseError)
        skipped++
      }
    }

    console.log(`[DbMigrations] Migrated ${migrated} turns from JSONL to database (${skipped} skipped)`)

    // Recompute aggregates for affected sessions
    if (sessionsToRecompute.size > 0) {
      console.log(`[DbMigrations] Recomputing aggregates for ${sessionsToRecompute.size} sessions...`)
      for (const sessionId of sessionsToRecompute) {
        recomputeSessionAggregates(db, sessionId)
      }
    }

    // Rename the old file to indicate migration is complete (even if all skipped)
    // This prevents re-processing orphan turns on every startup
    const backupPath = turnsJsonlPath + '.migrated'
    await rename(turnsJsonlPath, backupPath)
    console.log(`[DbMigrations] Renamed turns.jsonl to ${backupPath}`)

    return migrated
  } catch (error) {
    console.error('[DbMigrations] Failed to migrate turns:', error)
    return 0
  }
}

// ============================================================================
// Session Title Migration (from "Imported Session" to slug-based titles)
// ============================================================================

/**
 * Convert Claude's slug format to a readable title
 * e.g., "sparkling-orbiting-pascal" → "Sparkling Orbiting Pascal"
 */
function slugToTitle(slug: string): string {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

/**
 * Check if sessions need title migration from "Imported Session" placeholder
 */
export async function needsSessionTitleMigration(db: BetterSqlite3.Database): Promise<boolean> {
  const count = db.prepare(`
    SELECT COUNT(*) as count FROM sessions
    WHERE title = 'Imported Session'
    AND native_storage_path IS NOT NULL
  `).get() as { count: number }

  return count.count > 0
}

/**
 * Migrate session titles from "Imported Session" placeholder to slug-based titles
 * Reads the native JSONL files to extract Claude's auto-generated slug
 * @returns Number of sessions updated
 */
export async function migrateSessionTitles(db: BetterSqlite3.Database): Promise<number> {
  // Find all sessions with placeholder title and a native storage path
  const sessions = db.prepare(`
    SELECT id, native_storage_path FROM sessions
    WHERE title = 'Imported Session'
    AND native_storage_path IS NOT NULL
  `).all() as Array<{ id: string; native_storage_path: string }>

  if (sessions.length === 0) {
    return 0
  }

  console.log(`[DbMigrations] Found ${sessions.length} sessions needing title migration`)

  const updateStmt = db.prepare('UPDATE sessions SET title = ? WHERE id = ?')
  let updated = 0
  let skipped = 0

  for (const session of sessions) {
    try {
      // Read first few KB of file to find slug (usually in first few entries)
      const { createReadStream } = await import('fs')
      const slug = await new Promise<string | null>((resolve) => {
        const stream = createReadStream(session.native_storage_path, {
          encoding: 'utf8',
          start: 0,
          end: 50000  // Read first 50KB which should contain slug
        })

        let content = ''
        stream.on('data', (chunk) => { content += chunk })
        stream.on('end', () => {
          // Look for slug in content
          const slugMatch = content.match(/"slug"\s*:\s*"([^"]+)"/)
          resolve(slugMatch ? slugMatch[1] : null)
        })
        stream.on('error', () => resolve(null))
      })

      if (slug) {
        const title = slugToTitle(slug)
        updateStmt.run(title, session.id)
        updated++
        console.log(`[DbMigrations] Updated session ${session.id} title to: ${title}`)
      } else {
        skipped++
      }
    } catch (error) {
      console.warn(`[DbMigrations] Failed to read slug for session ${session.id}:`, error)
      skipped++
    }
  }

  console.log(`[DbMigrations] Session title migration complete: ${updated} updated, ${skipped} skipped`)
  return updated
}
