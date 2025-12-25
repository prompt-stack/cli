/**
 * Database connection module for pstack CLI
 * Uses better-sqlite3 for synchronous, fast SQLite access
 */

import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const PROMPT_STACK_HOME = path.join(os.homedir(), '.prompt-stack');
const DB_PATH = path.join(PROMPT_STACK_HOME, 'prompt-stack.db');

let db = null;

/**
 * Get or create the database connection
 * @param {Object} options - Connection options
 * @param {boolean} options.readonly - Open in read-only mode
 * @returns {Database.Database} SQLite database instance
 */
function getDb(options = {}) {
  if (!db) {
    // Ensure directory exists
    if (!fs.existsSync(PROMPT_STACK_HOME)) {
      fs.mkdirSync(PROMPT_STACK_HOME, { recursive: true });
    }

    db = new Database(DB_PATH, {
      readonly: options.readonly || false
    });

    // Enable WAL mode for better concurrent access
    db.pragma('journal_mode = WAL');

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Performance optimizations
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000'); // 64MB cache
  }
  return db;
}

/**
 * Close the database connection
 */
function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Check if database exists and is initialized
 * @returns {boolean}
 */
function isDatabaseInitialized() {
  if (!fs.existsSync(DB_PATH)) {
    return false;
  }

  try {
    const testDb = new Database(DB_PATH, { readonly: true });
    const result = testDb.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='schema_version'
    `).get();
    testDb.close();
    return !!result;
  } catch {
    return false;
  }
}

/**
 * Get database file path
 * @returns {string}
 */
function getDbPath() {
  return DB_PATH;
}

/**
 * Get database file size in bytes
 * @returns {number|null}
 */
function getDbSize() {
  try {
    const stats = fs.statSync(DB_PATH);
    return stats.size;
  } catch {
    return null;
  }
}

export {
  getDb,
  closeDb,
  isDatabaseInitialized,
  getDbPath,
  getDbSize,
  DB_PATH,
  PROMPT_STACK_HOME
};
