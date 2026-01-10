/**
 * Database Project Operations
 *
 * CRUD operations for projects (session groupings).
 */

import type BetterSqlite3 from 'better-sqlite3'
import type { ProviderId } from './sessions-v2'
import type { Project, ProjectCreateOptions, ProjectUpdateData, DbProject } from './types'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map database row to Project type
 */
function mapDbProjectToProject(row: DbProject): Project {
  return {
    id: row.id,
    provider: row.provider as ProviderId,
    name: row.name,
    createdAt: row.created_at,
    color: row.color || undefined,
    settings: row.settings ? JSON.parse(row.settings) : undefined,
  }
}

// ============================================================================
// Project CRUD Operations
// ============================================================================

/**
 * Create a new project
 */
export function createProject(db: BetterSqlite3.Database, options: ProjectCreateOptions): Project {
  const id = options.id || `project-${Date.now()}`
  const now = new Date().toISOString()

  const stmt = db.prepare(`
    INSERT INTO projects (id, provider, name, color, settings, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    id,
    options.provider,
    options.name,
    options.color ?? null,
    options.settings ? JSON.stringify(options.settings) : null,
    now
  )

  console.log('[DbProjects] Created project:', id, 'provider:', options.provider)

  return getProject(db, id)!
}

/**
 * Get a project by ID
 */
export function getProject(db: BetterSqlite3.Database, id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as DbProject | undefined
  return row ? mapDbProjectToProject(row) : null
}

/**
 * List projects with optional provider filter
 */
export function listProjects(db: BetterSqlite3.Database, provider?: ProviderId): Project[] {
  let sql = 'SELECT * FROM projects'
  const params: string[] = []

  if (provider) {
    sql += ' WHERE provider = ?'
    params.push(provider)
  }

  sql += ' ORDER BY created_at DESC'

  const rows = db.prepare(sql).all(...params) as DbProject[]

  // Get session counts and costs for each project
  return rows.map(row => {
    const project = mapDbProjectToProject(row)

    // Get aggregated data from sessions
    const stats = db.prepare(`
      SELECT
        COUNT(*) as session_count,
        SUM(total_cost) as total_cost
      FROM sessions
      WHERE project_id = ? AND status != 'deleted'
    `).get(row.id) as { session_count: number; total_cost: number } | undefined

    if (stats) {
      project.sessionCount = stats.session_count || 0
      project.totalCost = stats.total_cost || 0
    }

    return project
  })
}

/**
 * Update a project
 */
export function updateProject(db: BetterSqlite3.Database, projectId: string, data: ProjectUpdateData): void {
  const updates: string[] = []
  const values: (string | null)[] = []

  if (data.name !== undefined) {
    updates.push('name = ?')
    values.push(data.name)
  }
  if (data.color !== undefined) {
    updates.push('color = ?')
    values.push(data.color)
  }
  if (data.settings !== undefined) {
    updates.push('settings = ?')
    values.push(data.settings ? JSON.stringify(data.settings) : null)
  }

  if (updates.length === 0) {
    return
  }

  values.push(projectId)
  const sql = `UPDATE projects SET ${updates.join(', ')} WHERE id = ?`
  db.prepare(sql).run(...values)

  console.log('[DbProjects] Updated project:', projectId)
}

/**
 * Delete a project (hard delete - sessions are moved to Inbox)
 */
export function deleteProject(db: BetterSqlite3.Database, projectId: string): void {
  // Move all sessions in this project to Inbox
  db.prepare('UPDATE sessions SET project_id = NULL WHERE project_id = ?').run(projectId)

  // Delete the project
  db.prepare('DELETE FROM projects WHERE id = ?').run(projectId)

  console.log('[DbProjects] Deleted project:', projectId)
}

/**
 * Get project session count
 * Uses same filters as listSessions for consistency:
 * - Excludes deleted sessions
 * - Excludes empty sessions (turn_count = 0)
 * - Excludes warmup/sidechain sessions
 */
export function getProjectSessionCount(db: BetterSqlite3.Database, projectId: string): number {
  const result = db.prepare(`
    SELECT COUNT(*) as count
    FROM sessions
    WHERE project_id = ?
      AND status != 'deleted'
      AND turn_count > 0
      AND (is_warmup IS NULL OR is_warmup = 0)
      AND (is_sidechain IS NULL OR is_sidechain = 0)
      AND (session_type IS NULL OR session_type = 'main')
  `).get(projectId) as { count: number } | undefined

  return result?.count || 0
}
