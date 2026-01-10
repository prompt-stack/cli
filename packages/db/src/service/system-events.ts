/**
 * System Events Database Operations
 *
 * Handles storage and retrieval of system events (compaction, config changes, summaries).
 * These events are written by Claude and other providers to track session lifecycle.
 */

import type { Database } from 'better-sqlite3'
import type { DbSystemEvent, SystemEvent, SystemEventCreateOptions } from './types'

// ============================================================================
// Mappers
// ============================================================================

function mapDbToSystemEvent(row: DbSystemEvent): SystemEvent {
  let payload: Record<string, unknown> | null = null
  if (row.payload) {
    try {
      payload = JSON.parse(row.payload)
    } catch {
      payload = null
    }
  }

  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type as SystemEvent['eventType'],
    payload,
    ts: row.ts,
    tsMs: row.ts_ms,
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all system events for a session
 */
export function getSystemEventsForSession(
  db: Database,
  sessionId: string
): SystemEvent[] {
  const stmt = db.prepare(`
    SELECT id, session_id, event_type, payload, ts, ts_ms
    FROM system_events
    WHERE session_id = ?
    ORDER BY ts_ms ASC, ts ASC
  `)

  const rows = stmt.all(sessionId) as DbSystemEvent[]
  return rows.map(mapDbToSystemEvent)
}

/**
 * Get compaction events for a session
 */
export function getCompactionEventsForSession(
  db: Database,
  sessionId: string
): SystemEvent[] {
  const stmt = db.prepare(`
    SELECT id, session_id, event_type, payload, ts, ts_ms
    FROM system_events
    WHERE session_id = ?
      AND event_type = 'system'
      AND json_extract(payload, '$.compactMetadata') IS NOT NULL
    ORDER BY ts_ms ASC, ts ASC
  `)

  const rows = stmt.all(sessionId) as DbSystemEvent[]
  return rows.map(mapDbToSystemEvent)
}

/**
 * Get the most recent compaction event for a session
 */
export function getLatestCompactionEvent(
  db: Database,
  sessionId: string
): SystemEvent | null {
  const stmt = db.prepare(`
    SELECT id, session_id, event_type, payload, ts, ts_ms
    FROM system_events
    WHERE session_id = ?
      AND event_type = 'system'
      AND json_extract(payload, '$.compactMetadata') IS NOT NULL
    ORDER BY ts_ms DESC, ts DESC
    LIMIT 1
  `)

  const row = stmt.get(sessionId) as DbSystemEvent | undefined
  return row ? mapDbToSystemEvent(row) : null
}

/**
 * Create a system event
 */
export function createSystemEvent(
  db: Database,
  options: SystemEventCreateOptions & { id: string }
): SystemEvent {
  const ts = options.ts || new Date().toISOString()
  const tsMs = new Date(ts).getTime()

  const stmt = db.prepare(`
    INSERT INTO system_events (id, session_id, event_type, payload, ts, ts_ms)
    VALUES (?, ?, ?, ?, ?, ?)
  `)

  stmt.run(
    options.id,
    options.sessionId,
    options.eventType,
    options.payload ? JSON.stringify(options.payload) : null,
    ts,
    tsMs
  )

  return {
    id: options.id,
    sessionId: options.sessionId,
    eventType: options.eventType,
    payload: options.payload || null,
    ts,
    tsMs,
  }
}

/**
 * Get summary events for a session (for title/description)
 */
export function getSummaryEventsForSession(
  db: Database,
  sessionId: string
): SystemEvent[] {
  const stmt = db.prepare(`
    SELECT id, session_id, event_type, payload, ts, ts_ms
    FROM system_events
    WHERE session_id = ?
      AND event_type = 'summary'
    ORDER BY ts_ms DESC, ts DESC
  `)

  const rows = stmt.all(sessionId) as DbSystemEvent[]
  return rows.map(mapDbToSystemEvent)
}
