/**
 * File Version Database Service
 *
 * Manages file version history in SQLite + blob storage.
 *
 * Mental model:
 * - Files have UUIDs that survive renames
 * - Revisions are immutable, append-only
 * - Content stored as gzip blobs (content-addressed)
 * - Revert creates new revision, never deletes
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import * as crypto from 'crypto'
import * as zlib from 'zlib'
import { promisify } from 'util'
import { dbConnection } from './connection'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

type ChangeRegistryLike = {
  getPendingForPath: (filePath: string) => Array<{ id: string; baseHash?: string }>
  markBlocked: (id: string, info: { reason: string; baseHash?: string }) => void
  markStale: (id: string, info: { reason: string; baseHash?: string; currentDiskHash?: string }) => void
}

let changeRegistryProvider:
  | (() => ChangeRegistryLike | Promise<ChangeRegistryLike | null>)
  | null = null

export function setChangeRegistryProvider(
  provider: (() => ChangeRegistryLike | Promise<ChangeRegistryLike | null>) | null
): void {
  changeRegistryProvider = provider
}

async function resolveChangeRegistry(): Promise<ChangeRegistryLike | null> {
  if (!changeRegistryProvider) return null
  const registry = await changeRegistryProvider()
  return registry || null
}

// ============================================================================
// Types
// ============================================================================

export type RevisionKind = 'edit' | 'revert' | 'import' | 'external' | 'delete'
export type RevisionAuthor = 'agent' | 'user' | 'external' | 'system'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface TrackedFile {
  id: string
  currentPath: string
  riskLevel: RiskLevel
  createdAt: string
  deletedAt: string | null
}

export interface FileRevision {
  id: string
  fileId: string
  revisionNumber: number
  parentRevisionId: string | null
  contentHash: string
  sizeBytes: number
  kind: RevisionKind
  author: RevisionAuthor
  summary: string | null
  isBinary: boolean
  revertedToRevisionId: string | null
  createdAt: string
  pathAtRevision: string
}

export interface CreateRevisionInput {
  filePath: string
  content: string
  kind: RevisionKind
  author: RevisionAuthor
  summary?: string
  revertedToRevisionId?: string
  isBinary?: boolean
}

// ============================================================================
// Blob Storage
// ============================================================================

class BlobStore {
  private blobDir: string

  constructor() {
    this.blobDir = path.join(dbConnection.getDbDir(), 'blobs')
  }

  async ensureDir(): Promise<void> {
    await fs.mkdir(this.blobDir, { recursive: true })
  }

  /**
   * Store content and return hash
   * Content-addressed: same content = same hash = no duplicate storage
   */
  async store(content: string): Promise<{ hash: string; sizeBytes: number }> {
    await this.ensureDir()

    const sizeBytes = Buffer.byteLength(content, 'utf-8')
    const hash = crypto.createHash('sha256').update(content).digest('hex')
    const blobPath = path.join(this.blobDir, `${hash}.gz`)

    // Skip if already exists (content-addressed deduplication)
    try {
      await fs.access(blobPath)
      return { hash, sizeBytes }
    } catch {
      // Doesn't exist, need to write
    }

    // Atomic write: temp file + rename
    const tempPath = `${blobPath}.tmp.${Date.now()}`
    try {
      const compressed = await gzip(Buffer.from(content, 'utf-8'))
      await fs.writeFile(tempPath, compressed)
      await fs.rename(tempPath, blobPath)
    } catch (err) {
      // Cleanup on failure
      await fs.unlink(tempPath).catch(() => {})
      throw err
    }

    return { hash, sizeBytes }
  }

  /**
   * Load content by hash
   */
  async load(hash: string): Promise<string | null> {
    const blobPath = path.join(this.blobDir, `${hash}.gz`)

    try {
      const compressed = await fs.readFile(blobPath)
      const content = await gunzip(compressed)
      return content.toString('utf-8')
    } catch {
      return null
    }
  }

  /**
   * Check if blob exists
   */
  async exists(hash: string): Promise<boolean> {
    const blobPath = path.join(this.blobDir, `${hash}.gz`)
    try {
      await fs.access(blobPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Delete blob (only if no revisions reference it)
   */
  async delete(hash: string): Promise<boolean> {
    const blobPath = path.join(this.blobDir, `${hash}.gz`)
    try {
      await fs.unlink(blobPath)
      return true
    } catch {
      return false
    }
  }
}

// ============================================================================
// Database Service
// ============================================================================

class FileVersionsService {
  private blobs = new BlobStore()

  // Risk classification patterns
  private HIGH_RISK = [
    /\.(sh|bash|zsh|ps1|bat|cmd)$/i,
    /\.(env|env\..*)$/i,
    /(^|\/)\.env/,
    /package\.json$/,
    /(^|\/)(docker|compose).*\.ya?ml$/i,
    /Dockerfile/i,
    /credentials|secret|\.pem$|\.key$/i,
  ]

  private MEDIUM_RISK = [
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java)$/i,
    /\.(sql|graphql|json|yaml|yml|toml)$/i,
  ]

  classifyRisk(filePath: string): RiskLevel {
    for (const pattern of this.HIGH_RISK) {
      if (pattern.test(filePath)) return 'high'
    }
    for (const pattern of this.MEDIUM_RISK) {
      if (pattern.test(filePath)) return 'medium'
    }
    return 'low'
  }

  /**
   * Get or create a tracked file record
   * File identity is GLOBAL - no workspace/project association here
   *
   * IMPORTANT: filePath must be canonical (via normalizePath/realpath).
   * Do not pass raw user input here - normalize first!
   */
  getOrCreateFile(filePath: string): TrackedFile {
    const db = dbConnection.getDb()

    // Check if active file exists by path (UNIQUE on non-deleted)
    const file = db.prepare(`
      SELECT id, current_path as currentPath,
             risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
      FROM tracked_files WHERE current_path = ? AND deleted_at IS NULL
    `).get(filePath) as TrackedFile | undefined

    if (file) {
      return file
    }

    // Check if there's a deleted file at this path - resurrect it
    const deletedFile = db.prepare(`
      SELECT id, current_path as currentPath,
             risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
      FROM tracked_files WHERE current_path = ? AND deleted_at IS NOT NULL
      ORDER BY deleted_at DESC LIMIT 1
    `).get(filePath) as TrackedFile | undefined

    if (deletedFile) {
      // Resurrect: clear deleted_at to bring file back with same ID + history
      db.prepare(`UPDATE tracked_files SET deleted_at = NULL WHERE id = ?`).run(deletedFile.id)
      console.log('[FileVersions] Resurrected deleted file:', deletedFile.id, filePath)
      return { ...deletedFile, deletedAt: null }
    }

    // Create new file record (global identity)
    const id = `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const now = new Date().toISOString()
    const riskLevel = this.classifyRisk(filePath)

    db.prepare(`
      INSERT INTO tracked_files (id, current_path, risk_level, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, filePath, riskLevel, now)

    return {
      id,
      currentPath: filePath,
      riskLevel,
      createdAt: now,
      deletedAt: null,
    }
  }

  /**
   * Create a new revision (the main entry point)
   */
  async createRevision(input: CreateRevisionInput): Promise<FileRevision> {
    const db = dbConnection.getDb()

    // Get or create file record (global identity)
    const file = this.getOrCreateFile(input.filePath)

    // Store content in blob storage
    const { hash, sizeBytes } = await this.blobs.store(input.content)

    // Get latest revision number
    const latest = db.prepare(`
      SELECT revision_number FROM file_revisions
      WHERE file_id = ? ORDER BY revision_number DESC LIMIT 1
    `).get(file.id) as { revision_number: number } | undefined

    const revisionNumber = (latest?.revision_number ?? 0) + 1
    const parentRevisionId = latest ? db.prepare(`
      SELECT id FROM file_revisions WHERE file_id = ? AND revision_number = ?
    `).get(file.id, latest.revision_number) as { id: string } | undefined : undefined

    // Create revision record
    const id = `rev_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
    const now = new Date().toISOString()

    const isBinary = input.isBinary ?? false

    db.prepare(`
      INSERT INTO file_revisions (
        id, file_id, revision_number, parent_revision_id,
        content_hash, size_bytes, kind, author, summary, is_binary,
        reverted_to_revision_id, created_at, path_at_revision
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      file.id,
      revisionNumber,
      parentRevisionId?.id ?? null,
      hash,
      sizeBytes,
      input.kind,
      input.author,
      input.summary ?? null,
      isBinary ? 1 : 0,
      input.revertedToRevisionId ?? null,
      now,
      input.filePath
    )

    console.log('[FileVersions] Created revision %d for %s: %s',
      revisionNumber, input.filePath, input.summary ?? input.kind)

    return {
      id,
      fileId: file.id,
      revisionNumber,
      parentRevisionId: parentRevisionId?.id ?? null,
      contentHash: hash,
      sizeBytes,
      kind: input.kind,
      author: input.author,
      summary: input.summary ?? null,
      isBinary,
      revertedToRevisionId: input.revertedToRevisionId ?? null,
      createdAt: now,
      pathAtRevision: input.filePath,
    }
  }

  /**
   * Get all tracked files with their latest revision
   * Returns global file list (no workspace filtering here)
   */
  listFiles(): Array<TrackedFile & { latestRevision?: FileRevision }> {
    const db = dbConnection.getDb()

    const files = db.prepare(`
      SELECT id, current_path as currentPath,
             risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
      FROM tracked_files
      WHERE deleted_at IS NULL
      ORDER BY created_at DESC
    `).all() as TrackedFile[]

    return files.map(file => {
      const latest = this.getLatestRevision(file.id)
      return { ...file, latestRevision: latest ?? undefined }
    })
  }

  /**
   * Get revision history for a file
   */
  getFileHistory(fileId: string): FileRevision[] {
    const db = dbConnection.getDb()

    const rows = db.prepare(`
      SELECT id, file_id as fileId, revision_number as revisionNumber,
             parent_revision_id as parentRevisionId, content_hash as contentHash,
             size_bytes as sizeBytes, kind, author, summary, is_binary,
             reverted_to_revision_id as revertedToRevisionId,
             created_at as createdAt, path_at_revision as pathAtRevision
      FROM file_revisions
      WHERE file_id = ?
      ORDER BY revision_number DESC
    `).all(fileId) as Array<Omit<FileRevision, 'isBinary'> & { is_binary: number }>

    return rows.map(r => ({ ...r, isBinary: r.is_binary === 1 }))
  }

  /**
   * Get the latest revision for a file
   */
  getLatestRevision(fileId: string): FileRevision | null {
    const db = dbConnection.getDb()

    const row = db.prepare(`
      SELECT id, file_id as fileId, revision_number as revisionNumber,
             parent_revision_id as parentRevisionId, content_hash as contentHash,
             size_bytes as sizeBytes, kind, author, summary, is_binary,
             reverted_to_revision_id as revertedToRevisionId,
             created_at as createdAt, path_at_revision as pathAtRevision
      FROM file_revisions
      WHERE file_id = ?
      ORDER BY revision_number DESC
      LIMIT 1
    `).get(fileId) as (Omit<FileRevision, 'isBinary'> & { is_binary: number }) | null

    return row ? { ...row, isBinary: row.is_binary === 1 } : null
  }

  /**
   * Get a specific revision
   */
  getRevision(revisionId: string): FileRevision | null {
    const db = dbConnection.getDb()

    const row = db.prepare(`
      SELECT id, file_id as fileId, revision_number as revisionNumber,
             parent_revision_id as parentRevisionId, content_hash as contentHash,
             size_bytes as sizeBytes, kind, author, summary, is_binary,
             reverted_to_revision_id as revertedToRevisionId,
             created_at as createdAt, path_at_revision as pathAtRevision
      FROM file_revisions
      WHERE id = ?
    `).get(revisionId) as (Omit<FileRevision, 'isBinary'> & { is_binary: number }) | null

    return row ? { ...row, isBinary: row.is_binary === 1 } : null
  }

  /**
   * Load content for a revision
   */
  async loadRevisionContent(revisionId: string): Promise<string | null> {
    const revision = this.getRevision(revisionId)
    if (!revision) return null

    return this.blobs.load(revision.contentHash)
  }

  /**
   * Revert to a specific revision
   * Creates a new revision with the old content
   */
  async revertToRevision(fileId: string, targetRevisionNumber: number): Promise<FileRevision> {
    const db = dbConnection.getDb()

    // Get target revision
    const target = db.prepare(`
      SELECT * FROM file_revisions
      WHERE file_id = ? AND revision_number = ?
    `).get(fileId, targetRevisionNumber) as { id: string; content_hash: string; path_at_revision: string } | undefined

    if (!target) {
      throw new Error(`Revision ${targetRevisionNumber} not found for file ${fileId}`)
    }

    // Load content from blob
    const content = await this.blobs.load(target.content_hash)
    if (content === null) {
      throw new Error(`Content not found for revision ${targetRevisionNumber}`)
    }

    // Get file info
    const file = db.prepare(`
      SELECT current_path FROM tracked_files WHERE id = ?
    `).get(fileId) as { current_path: string }

    // Write content to disk
    await fs.writeFile(file.current_path, content, 'utf-8')

    // Create new revision
    return this.createRevision({
      filePath: file.current_path,
      content,
      kind: 'revert',
      author: 'user',
      summary: `Reverted to v${targetRevisionNumber}`,
      revertedToRevisionId: target.id,
    })
  }

  /**
   * Get file by path (global lookup)
   * Only returns active (non-deleted) files
   */
  getFileByPath(filePath: string): TrackedFile | null {
    const db = dbConnection.getDb()

    const result = db.prepare(`
      SELECT id, current_path as currentPath,
             risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
      FROM tracked_files
      WHERE current_path = ? AND deleted_at IS NULL
    `).get(filePath) as TrackedFile | undefined

    return result ?? null
  }

  /**
   * Get file by path including deleted files
   * Used for resurrection and external change detection
   */
  getFileByPathIncludingDeleted(filePath: string): TrackedFile | null {
    const db = dbConnection.getDb()

    const result = db.prepare(`
      SELECT id, current_path as currentPath,
             risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
      FROM tracked_files
      WHERE current_path = ?
      ORDER BY deleted_at DESC NULLS FIRST
      LIMIT 1
    `).get(filePath) as TrackedFile | undefined

    return result ?? null
  }

  /**
   * Update file path (for rename support)
   * This preserves the file's UUID and history across renames
   */
  updateFilePath(fileId: string, newPath: string): void {
    const db = dbConnection.getDb()

    db.prepare(`
      UPDATE tracked_files SET current_path = ? WHERE id = ?
    `).run(newPath, fileId)

    console.log('[FileVersions] Updated path for %s: %s', fileId, newPath)
  }

  /**
   * Find file by a path that may have been renamed
   * Checks current_path first, then falls back to path_at_revision
   */
  findFileByAnyPath(filePath: string): TrackedFile | null {
    const db = dbConnection.getDb()

    // Try current path first
    const file = this.getFileByPath(filePath)
    if (file) return file

    // Fall back to finding by path_at_revision (handles renames)
    const revision = db.prepare(`
      SELECT file_id FROM file_revisions WHERE path_at_revision = ?
      ORDER BY created_at DESC LIMIT 1
    `).get(filePath) as { file_id: string } | undefined

    if (revision) {
      return db.prepare(`
        SELECT id, current_path as currentPath,
               risk_level as riskLevel, created_at as createdAt, deleted_at as deletedAt
        FROM tracked_files WHERE id = ?
      `).get(revision.file_id) as TrackedFile | null
    }

    return null
  }

  /**
   * Prune old revisions (keeps referenced blobs)
   */
  async pruneOldRevisions(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const db = dbConnection.getDb()
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString()

    // Get hashes that will be orphaned
    const toDelete = db.prepare(`
      SELECT DISTINCT content_hash FROM file_revisions
      WHERE created_at < ?
      AND content_hash NOT IN (
        SELECT content_hash FROM file_revisions WHERE created_at >= ?
      )
    `).all(cutoff, cutoff) as { content_hash: string }[]

    // Delete old revisions
    const result = db.prepare(`
      DELETE FROM file_revisions WHERE created_at < ?
    `).run(cutoff)

    // Delete orphaned blobs
    for (const { content_hash } of toDelete) {
      await this.blobs.delete(content_hash)
    }

    console.log('[FileVersions] Pruned %d revisions, %d blobs', result.changes, toDelete.length)

    return result.changes
  }

  // ==========================================================================
  // External Change Detection
  // ==========================================================================

  /**
   * Self-write guard: paths that RUDI just wrote to
   * Prevents detecting our own writes as external changes
   */
  private recentWrites = new Set<string>()
  private writeGuardTimeoutMs = 2000

  /**
   * Mark a path as recently written by RUDI
   * Call this BEFORE writing to disk to prevent false external detection
   */
  markSelfWrite(filePath: string): void {
    this.recentWrites.add(filePath)
    setTimeout(() => {
      this.recentWrites.delete(filePath)
    }, this.writeGuardTimeoutMs)
  }

  /**
   * Check if a path was recently written by RUDI
   */
  isSelfWrite(filePath: string): boolean {
    return this.recentWrites.has(filePath)
  }

  /**
   * Compute hash of current disk content for comparison
   */
  private computeFileHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  /**
   * Check if a tracked file has been modified externally
   * Returns the new disk content if modified, null if unchanged or untracked
   */
  async checkExternalEdit(filePath: string): Promise<{
    changed: boolean
    deleted: boolean
    newContent?: string
    newHash?: string
    latestHash?: string
  }> {
    // Skip if this is a self-write (RUDI just wrote this)
    if (this.isSelfWrite(filePath)) {
      return { changed: false, deleted: false }
    }

    const file = this.getFileByPath(filePath)
    if (!file) {
      // Not tracked - no external change to detect
      return { changed: false, deleted: false }
    }

    const latestRevision = this.getLatestRevision(file.id)
    if (!latestRevision) {
      // No revisions yet - treat as untracked
      return { changed: false, deleted: false }
    }

    // Check if file still exists on disk
    try {
      await fs.access(filePath)
    } catch {
      // File deleted externally
      return {
        changed: true,
        deleted: true,
        latestHash: latestRevision.contentHash,
      }
    }

    // Read current disk content and compute hash
    try {
      const diskContent = await fs.readFile(filePath, 'utf-8')
      const diskHash = this.computeFileHash(diskContent)

      if (diskHash !== latestRevision.contentHash) {
        return {
          changed: true,
          deleted: false,
          newContent: diskContent,
          newHash: diskHash,
          latestHash: latestRevision.contentHash,
        }
      }
    } catch (err) {
      console.error('[FileVersions] Error reading file for external check:', filePath, err)
    }

    return { changed: false, deleted: false }
  }

  /**
   * Record an external edit as a new revision
   * Call this when disk content differs from latest revision
   */
  async recordExternalEdit(filePath: string, content: string): Promise<FileRevision> {
    console.log('[FileVersions] Recording external edit:', filePath)

    return this.createRevision({
      filePath,
      content,
      kind: 'external',
      author: 'external',
      summary: 'Edited outside RUDI',
    })
  }

  /**
   * Record an external delete
   * Creates a 'delete' revision and marks the file as deleted
   */
  async recordExternalDelete(filePath: string): Promise<FileRevision | null> {
    const file = this.getFileByPath(filePath)
    if (!file) {
      console.log('[FileVersions] Cannot record delete for untracked file:', filePath)
      return null
    }

    // Check if already marked as deleted (idempotent)
    if (file.deletedAt) {
      console.log('[FileVersions] File already marked deleted:', filePath)
      return null
    }

    console.log('[FileVersions] Recording external delete:', filePath)

    const db = dbConnection.getDb()
    const now = new Date().toISOString()

    // Create delete revision with empty content
    const revision = await this.createRevision({
      filePath,
      content: '',
      kind: 'delete',
      author: 'external',
      summary: 'Deleted outside RUDI',
    })

    // Mark file as deleted
    db.prepare(`
      UPDATE tracked_files SET deleted_at = ? WHERE id = ?
    `).run(now, file.id)

    return revision
  }

  /**
   * Audit all tracked files for external changes
   * Call this on app startup, window focus, or periodically
   *
   * Returns summary of changes detected and recorded
   */
  async auditTrackedFiles(): Promise<{
    edits: Array<{ path: string; fileId: string }>
    deletes: Array<{ path: string; fileId: string }>
    errors: Array<{ path: string; error: string }>
  }> {
    const result = {
      edits: [] as Array<{ path: string; fileId: string }>,
      deletes: [] as Array<{ path: string; fileId: string }>,
      errors: [] as Array<{ path: string; error: string }>,
    }

    const files = this.listFiles()

    for (const file of files) {
      try {
        const check = await this.checkExternalEdit(file.currentPath)

        if (check.changed) {
          if (check.deleted) {
            // External delete
            const rev = await this.recordExternalDelete(file.currentPath)
            if (rev) {
              result.deletes.push({ path: file.currentPath, fileId: file.id })
            }
          } else if (check.newContent !== undefined) {
            // External edit
            await this.recordExternalEdit(file.currentPath, check.newContent)
            result.edits.push({ path: file.currentPath, fileId: file.id })
          }
        }
      } catch (err) {
        result.errors.push({
          path: file.currentPath,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (result.edits.length > 0 || result.deletes.length > 0) {
      console.log(
        '[FileVersions] Audit complete: %d edits, %d deletes, %d errors',
        result.edits.length,
        result.deletes.length,
        result.errors.length
      )
    }

    return result
  }

  /**
   * Check if a specific file needs external change recording
   * Convenience method for single-file checks (e.g., on file watcher events)
   */
  async syncFileWithDisk(filePath: string): Promise<{
    action: 'none' | 'edit' | 'delete' | 'resurrect'
    revision?: FileRevision
  }> {
    // Skip self-writes
    if (this.isSelfWrite(filePath)) {
      return { action: 'none' }
    }

    // Check if file exists on disk
    let diskExists = false
    let diskContent: string | undefined

    try {
      diskContent = await fs.readFile(filePath, 'utf-8')
      diskExists = true
    } catch {
      diskExists = false
    }

    // Check for active file first
    const activeFile = this.getFileByPath(filePath)

    // Case: Active file exists - check for external edit or delete
    if (activeFile) {
      if (!diskExists) {
        // External delete
        const revision = await this.recordExternalDelete(filePath)
        return { action: 'delete', revision: revision ?? undefined }
      }

      // Check for external edit
      const latestRevision = this.getLatestRevision(activeFile.id)
      if (latestRevision && diskContent !== undefined) {
        const diskHash = this.computeFileHash(diskContent)
        if (diskHash !== latestRevision.contentHash) {
          const revision = await this.recordExternalEdit(filePath, diskContent)
          return { action: 'edit', revision }
        }
      }

      return { action: 'none' }
    }

    // Case: No active file - check if there's a deleted file to resurrect
    const deletedFile = this.getFileByPathIncludingDeleted(filePath)

    if (deletedFile && deletedFile.deletedAt && diskExists && diskContent !== undefined) {
      // Resurrect the deleted file
      console.log('[FileVersions] Resurrecting file:', filePath)
      const db = dbConnection.getDb()

      // Clear deleted_at to resurrect
      db.prepare(`UPDATE tracked_files SET deleted_at = NULL WHERE id = ?`).run(deletedFile.id)

      // Record the new content as an external edit
      const revision = await this.recordExternalEdit(filePath, diskContent)
      return { action: 'resurrect', revision }
    }

    // Case: File not tracked at all
    return { action: 'none' }
  }

  // ==========================================================================
  // ChangeRegistry Integration - Conflict Detection
  // ==========================================================================

  /**
   * Reconcile an external change with ALL pending ChangeRegistry entries for a path
   *
   * Call this after detecting an external edit/delete. It will:
   * 1. Find ALL pending changes for the path (handles edge cases)
   * 2. If pending + external edit → mark ALL stale (cannot apply safely)
   * 3. If pending + external delete → mark ALL blocked (file no longer exists)
   *
   * Returns count of affected changes and the action taken.
   */
  async reconcileExternalChange(
    filePath: string,
    type: 'edit' | 'delete',
    newHash?: string
  ): Promise<{
    hadPendingChange: boolean
    affectedCount: number
    affectedIds: string[]
    action: 'stale' | 'blocked' | 'none'
  }> {
    const changeRegistry = await resolveChangeRegistry()
    if (!changeRegistry) {
      return { hadPendingChange: false, affectedCount: 0, affectedIds: [], action: 'none' }
    }

    const pendingChanges = changeRegistry.getPendingForPath(filePath)
    if (pendingChanges.length === 0) {
      return { hadPendingChange: false, affectedCount: 0, affectedIds: [], action: 'none' }
    }

    const affectedIds: string[] = []
    const action = type === 'delete' ? 'blocked' : 'stale'

    console.log('[FileVersions] Reconciling external %s with %d pending change(s) for: %s',
      type, pendingChanges.length, filePath)

    for (const pending of pendingChanges) {
      if (type === 'delete') {
        // External delete with pending change → blocked
        changeRegistry.markBlocked(pending.id, {
          reason: 'EXTERNAL_DELETE',
          baseHash: pending.baseHash,
        })
      } else {
        // External edit with pending change → stale
        changeRegistry.markStale(pending.id, {
          reason: 'EXTERNAL_MODIFICATION',
          baseHash: pending.baseHash,
          currentDiskHash: newHash,
        })
      }
      affectedIds.push(pending.id)
    }

    return {
      hadPendingChange: true,
      affectedCount: affectedIds.length,
      affectedIds,
      action,
    }
  }

  /**
   * Full sync workflow: detect external change, record revision, and reconcile pending
   *
   * This is the main entry point for external change detection.
   * Call from filesystem watcher, window focus, or periodic scan.
   */
  async detectAndReconcile(filePath: string): Promise<{
    externalChange: 'none' | 'edit' | 'delete'
    revision?: FileRevision
    pendingAffected: boolean
    pendingAffectedCount: number
    pendingAffectedIds: string[]
    pendingAction: 'stale' | 'blocked' | 'none'
  }> {
    const result = {
      externalChange: 'none' as 'none' | 'edit' | 'delete',
      revision: undefined as FileRevision | undefined,
      pendingAffected: false,
      pendingAffectedCount: 0,
      pendingAffectedIds: [] as string[],
      pendingAction: 'none' as 'stale' | 'blocked' | 'none',
    }

    // Skip self-writes
    if (this.isSelfWrite(filePath)) {
      return result
    }

    // Check for external change
    const check = await this.checkExternalEdit(filePath)
    if (!check.changed) {
      return result
    }

    // Handle external delete
    if (check.deleted) {
      const revision = await this.recordExternalDelete(filePath)
      result.externalChange = 'delete'
      result.revision = revision ?? undefined

      // Reconcile with ALL pending changes
      const reconciled = await this.reconcileExternalChange(filePath, 'delete')
      result.pendingAffected = reconciled.hadPendingChange
      result.pendingAffectedCount = reconciled.affectedCount
      result.pendingAffectedIds = reconciled.affectedIds
      result.pendingAction = reconciled.action

      return result
    }

    // Handle external edit
    if (check.newContent !== undefined) {
      const revision = await this.recordExternalEdit(filePath, check.newContent)
      result.externalChange = 'edit'
      result.revision = revision

      // Reconcile with ALL pending changes
      const reconciled = await this.reconcileExternalChange(filePath, 'edit', check.newHash)
      result.pendingAffected = reconciled.hadPendingChange
      result.pendingAffectedCount = reconciled.affectedCount
      result.pendingAffectedIds = reconciled.affectedIds
      result.pendingAction = reconciled.action

      return result
    }

    return result
  }
}

// Singleton export
export const fileVersions = new FileVersionsService()
