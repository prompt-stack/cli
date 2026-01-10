/**
 * Database schema helpers for the Studio-facing service layer.
 *
 * Delegates schema definition to the shared @learnrudi/db schema.
 */

import type BetterSqlite3 from 'better-sqlite3'
import { initSchemaWithDb } from '../schema.js'

/**
 * Initialize database schema for a new DB.
 */
export function initializeSchema(db: BetterSqlite3.Database): void {
  initSchemaWithDb(db)
}

/**
 * Run migrations for an existing DB.
 */
export function runSchemaMigrations(db: BetterSqlite3.Database): void {
  initSchemaWithDb(db)
}
