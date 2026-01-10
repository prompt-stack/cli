/**
 * Database Connection Manager
 *
 * Handles SQLite database connection, initialization, and lifecycle.
 */

import { createRequire } from 'module'
import * as path from 'path'
import { mkdir, access } from 'fs/promises'
import { existsSync, mkdirSync } from 'fs'
import { PATHS } from '@learnrudi/env'
import type BetterSqlite3 from 'better-sqlite3'
import { logSqlitePragmas } from './performance'

// Use createRequire for CommonJS module (better-sqlite3 is CJS)
const require = createRequire(import.meta.url)
const Database: typeof BetterSqlite3 = require('better-sqlite3')

// ============================================================================
// Constants
// ============================================================================

const RUDI_DIR = PATHS.db
const DB_PATH = PATHS.dbFile

// ============================================================================
// Connection Manager
// ============================================================================

class DatabaseConnection {
  private db: BetterSqlite3.Database | null = null
  private isInitialized = false
  private dbPath: string = DB_PATH
  private dbDir: string = RUDI_DIR

  /**
   * Configure custom database path (for testing)
   * Must be called before initialize()
   */
  setDatabasePath(dbPath: string): void {
    if (this.isInitialized) {
      throw new Error('Cannot change database path after initialization')
    }
    this.dbPath = dbPath
    this.dbDir = path.dirname(dbPath)
  }

  /**
   * Get the database directory path
   */
  getDbDir(): string {
    return this.dbDir
  }

  /**
   * Get the database file path
   */
  getDbPath(): string {
    return this.dbPath
  }

  /**
   * Check if the database file exists (async version)
   */
  async isDatabaseAvailableAsync(): Promise<boolean> {
    if (this.dbPath === ':memory:') {
      return true
    }
    try {
      await access(this.dbPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Check if connected and initialized
   */
  isConnected(): boolean {
    return this.isInitialized && this.db !== null
  }

  /**
   * Initialize the database connection (async version)
   * @param onNewDatabase - Callback when a new database is created (for schema init)
   * @param onExistingDatabase - Callback for existing database (for migrations)
   * @returns true if successful
   */
  async initializeAsync(
    onNewDatabase?: (db: BetterSqlite3.Database) => void,
    onExistingDatabase?: (db: BetterSqlite3.Database) => void
  ): Promise<boolean> {
    if (this.isInitialized && this.db) {
      return true
    }

    try {
      // Ensure directory exists (skip for in-memory)
      if (this.dbPath !== ':memory:') {
        try {
          await access(this.dbDir)
        } catch {
          await mkdir(this.dbDir, { recursive: true })
        }
      }

      const dbExists = await this.isDatabaseAvailableAsync()

      // Open in read-write mode (creates if doesn't exist)
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')  // Wait up to 5s for locks instead of failing immediately
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = -64000')  // 64MB cache

      // Log actual pragma values for performance analysis
      logSqlitePragmas(this.db)

      // Initialize schema if database was just created
      if (!dbExists || this.dbPath === ':memory:') {
        console.log('[DbConnection] Creating new database')
        onNewDatabase?.(this.db)
      } else {
        // Run migrations for existing databases
        onExistingDatabase?.(this.db)
      }

      this.isInitialized = true
      console.log('[DbConnection] Connected to database (read-write):', this.dbPath)

      return true
    } catch (error) {
      console.error('[DbConnection] Failed to connect:', error)
      return false
    }
  }

  /**
   * Initialize the database connection (synchronous)
   *
   * @param onNewDatabase - Callback when a new database is created (for schema init)
   * @param onExistingDatabase - Callback for existing database (for migrations)
   * @returns true if successful
   */
  initialize(
    onNewDatabase?: (db: BetterSqlite3.Database) => void,
    onExistingDatabase?: (db: BetterSqlite3.Database) => void
  ): boolean {
    if (this.isInitialized && this.db) {
      return true
    }

    try {
      // Ensure directory exists (skip for in-memory)
      if (this.dbPath !== ':memory:') {
        if (!existsSync(this.dbDir)) {
          console.log('[DbConnection] Creating database directory:', this.dbDir)
          mkdirSync(this.dbDir, { recursive: true })
        }
      }

      // Check if database file exists before opening
      const dbExists = this.dbPath === ':memory:' || existsSync(this.dbPath)

      // Open in read-write mode (creates if doesn't exist)
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('busy_timeout = 5000')  // Wait up to 5s for locks instead of failing immediately
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('synchronous = NORMAL')
      this.db.pragma('cache_size = -64000')  // 64MB cache

      // Log actual pragma values for performance analysis
      logSqlitePragmas(this.db)

      // Initialize schema if database was just created
      if (!dbExists) {
        console.log('[DbConnection] Creating new database')
        onNewDatabase?.(this.db)
      } else {
        // Run migrations for existing databases
        console.log('[DbConnection] Opening existing database')
        onExistingDatabase?.(this.db)
      }

      this.isInitialized = true
      console.log('[DbConnection] Connected to database (read-write):', this.dbPath)

      return true
    } catch (error) {
      console.error('[DbConnection] Failed to connect:', error)
      return false
    }
  }

  /**
   * Get the raw database connection
   * @throws Error if not initialized
   */
  getDb(): BetterSqlite3.Database {
    if (!this.db || !this.isInitialized) {
      throw new Error('Database not initialized. Call initialize() first.')
    }
    return this.db
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      this.isInitialized = false
      console.log('[DbConnection] Connection closed')
    }
  }

  /**
   * Reset to default database path and close connection
   * Useful for testing cleanup
   */
  reset(): void {
    this.close()
    this.dbPath = DB_PATH
    this.dbDir = RUDI_DIR
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

export const dbConnection = new DatabaseConnection()
export { Database }
export type { BetterSqlite3 }
