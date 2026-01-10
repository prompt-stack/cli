/**
 * Database File Position Operations
 *
 * CRUD operations for tracking file byte offsets for incremental session file tailing.
 * This enables persisting watcher state across app restarts.
 */

import type BetterSqlite3 from 'better-sqlite3'
import type { ProviderId } from './sessions-v2'
import type { FilePosition, DbFilePosition } from './types'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Map database row to FilePosition type
 */
function mapDbFilePositionToFilePosition(row: DbFilePosition): FilePosition {
  return {
    filePath: row.file_path,
    byteOffset: row.byte_offset,
    fileSize: row.file_size,
    mtimeMs: row.mtime_ms,
    inode: row.inode,
    provider: row.provider as ProviderId,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  }
}

// ============================================================================
// CRUD Operations
// ============================================================================

/**
 * Get file position by path
 */
export function getFilePosition(
  db: BetterSqlite3.Database,
  filePath: string
): FilePosition | null {
  const row = db.prepare(
    'SELECT * FROM file_positions WHERE file_path = ?'
  ).get(filePath) as DbFilePosition | undefined

  return row ? mapDbFilePositionToFilePosition(row) : null
}

/**
 * Get all file positions for a provider
 */
export function getFilePositionsByProvider(
  db: BetterSqlite3.Database,
  provider: ProviderId
): FilePosition[] {
  const rows = db.prepare(
    'SELECT * FROM file_positions WHERE provider = ?'
  ).all(provider) as DbFilePosition[]

  return rows.map(mapDbFilePositionToFilePosition)
}

/**
 * Get all file positions
 */
export function getAllFilePositions(db: BetterSqlite3.Database): FilePosition[] {
  const rows = db.prepare('SELECT * FROM file_positions').all() as DbFilePosition[]
  return rows.map(mapDbFilePositionToFilePosition)
}

/**
 * Upsert file position (create or update)
 * Returns the upserted position
 */
export function upsertFilePosition(
  db: BetterSqlite3.Database,
  position: {
    filePath: string
    byteOffset: number
    fileSize: number
    mtimeMs: number
    inode?: string | null
    provider: ProviderId
  }
): FilePosition {
  const now = new Date().toISOString()

  // Use INSERT OR REPLACE for atomic upsert
  db.prepare(`
    INSERT INTO file_positions (
      file_path, byte_offset, file_size, mtime_ms, inode, provider, last_synced_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      byte_offset = excluded.byte_offset,
      file_size = excluded.file_size,
      mtime_ms = excluded.mtime_ms,
      inode = excluded.inode,
      last_synced_at = excluded.last_synced_at
  `).run(
    position.filePath,
    position.byteOffset,
    position.fileSize,
    position.mtimeMs,
    position.inode ?? null,
    position.provider,
    now,
    now
  )

  return getFilePosition(db, position.filePath)!
}

/**
 * Update file position (only updates offset/size/mtime, not provider)
 */
export function updateFilePosition(
  db: BetterSqlite3.Database,
  filePath: string,
  updates: {
    byteOffset?: number
    fileSize?: number
    mtimeMs?: number
    inode?: string | null
  }
): FilePosition | null {
  const existing = getFilePosition(db, filePath)
  if (!existing) {
    return null
  }

  const now = new Date().toISOString()
  const updateParts: string[] = ['last_synced_at = ?']
  const values: (string | number | null)[] = [now]

  if (updates.byteOffset !== undefined) {
    updateParts.push('byte_offset = ?')
    values.push(updates.byteOffset)
  }
  if (updates.fileSize !== undefined) {
    updateParts.push('file_size = ?')
    values.push(updates.fileSize)
  }
  if (updates.mtimeMs !== undefined) {
    updateParts.push('mtime_ms = ?')
    values.push(updates.mtimeMs)
  }
  if (updates.inode !== undefined) {
    updateParts.push('inode = ?')
    values.push(updates.inode)
  }

  values.push(filePath)

  db.prepare(`
    UPDATE file_positions SET ${updateParts.join(', ')} WHERE file_path = ?
  `).run(...values)

  return getFilePosition(db, filePath)
}

/**
 * Delete file position
 */
export function deleteFilePosition(
  db: BetterSqlite3.Database,
  filePath: string
): boolean {
  const result = db.prepare(
    'DELETE FROM file_positions WHERE file_path = ?'
  ).run(filePath)

  return result.changes > 0
}

/**
 * Delete all file positions for a provider
 */
export function deleteFilePositionsByProvider(
  db: BetterSqlite3.Database,
  provider: ProviderId
): number {
  const result = db.prepare(
    'DELETE FROM file_positions WHERE provider = ?'
  ).run(provider)

  return result.changes
}

/**
 * Reset file position to beginning (for re-sync)
 * Preserves the record but sets offset to 0
 */
export function resetFilePosition(
  db: BetterSqlite3.Database,
  filePath: string
): FilePosition | null {
  return updateFilePosition(db, filePath, {
    byteOffset: 0,
    fileSize: 0,
    mtimeMs: 0,
  })
}

/**
 * Check if file has changed (different size/mtime/inode) since last sync
 * Used to detect file replacement vs append
 */
export function hasFileChanged(
  db: BetterSqlite3.Database,
  filePath: string,
  currentStats: { size: number; mtimeMs: number; inode?: string }
): { changed: boolean; position: FilePosition | null; reason?: string } {
  const position = getFilePosition(db, filePath)

  if (!position) {
    return { changed: true, position: null, reason: 'new_file' }
  }

  // File was replaced (inode changed)
  if (position.inode && currentStats.inode && position.inode !== currentStats.inode) {
    return { changed: true, position, reason: 'inode_changed' }
  }

  // File was truncated/replaced (size decreased)
  if (currentStats.size < position.byteOffset) {
    return { changed: true, position, reason: 'file_truncated' }
  }

  // File has new content (size increased)
  if (currentStats.size > position.fileSize) {
    return { changed: false, position, reason: 'new_content' }
  }

  // No change
  return { changed: false, position }
}
