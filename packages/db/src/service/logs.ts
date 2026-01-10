/**
 * Observability logs - Store and query agent visibility events
 */

import type BetterSqlite3 from 'better-sqlite3'

export interface LogEvent {
  id: number
  timestamp: number
  source: string
  level: string
  type: string
  provider: string | null
  cid: string | null
  session_id: string | null
  terminal_id: number | null
  feature: string | null
  step: string | null
  duration_ms: number | null
  data_json: string
  created_at: string
}

/**
 * Store a log event from AgentVisibility
 */
export function storeLogEvent(db: BetterSqlite3.Database, event: any): void {
  const insert = db.prepare(`
    INSERT INTO logs (timestamp, source, level, type, provider, cid, session_id, terminal_id, feature, step, duration_ms, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insert.run(
    event.timestamp,
    event.data?.source || 'unknown',
    event.data?.level || 'info',
    event.type,
    event.data?.provider || null,
    event.cid || null,
    event.data?.sessionId || null,
    event.data?.terminalId || null,
    event.data?.feature || null,
    event.data?.step || null,
    event.data?.durationMs || (event.data as any)?.duration_ms || null,
    JSON.stringify(event.data || {})
  )
}

/**
 * Query logs with filters
 */
export function queryLogs(
  db: BetterSqlite3.Database,
  options: {
    limit?: number
    offset?: number
    since?: number
    until?: number
    source?: string
    level?: string
    type?: string
    provider?: string
    sessionId?: string
    terminalId?: number
    search?: string
    slowOnly?: boolean
    slowThreshold?: number
  } = {}
): LogEvent[] {
  const {
    limit = 50,
    offset = 0,
    since,
    until,
    source,
    level,
    type,
    provider,
    sessionId,
    terminalId,
    search,
    slowOnly = false,
    slowThreshold = 1000,
  } = options

  let query = 'SELECT * FROM logs WHERE 1=1'
  const params: any[] = []

  // Time filters
  if (since) {
    query += ' AND timestamp >= ?'
    params.push(since)
  }
  if (until) {
    query += ' AND timestamp <= ?'
    params.push(until)
  }

  // Attribute filters
  if (source) {
    query += ' AND source = ?'
    params.push(source)
  }
  if (level) {
    query += ' AND level = ?'
    params.push(level)
  }
  if (type) {
    query += ' AND type = ?'
    params.push(type)
  }
  if (provider) {
    query += ' AND provider = ?'
    params.push(provider)
  }
  if (sessionId) {
    query += ' AND session_id = ?'
    params.push(sessionId)
  }
  if (terminalId !== undefined) {
    query += ' AND terminal_id = ?'
    params.push(terminalId)
  }

  // Text search in JSON data
  if (search) {
    query += ' AND data_json LIKE ?'
    params.push(`%${search}%`)
  }

  // Performance filter
  if (slowOnly) {
    query += ' AND duration_ms >= ?'
    params.push(slowThreshold)
  }

  // Order and limit
  query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
  params.push(limit, offset)

  return db.prepare(query).all(...params) as LogEvent[]
}

/**
 * Get log count
 */
export function getLogCount(db: BetterSqlite3.Database): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM logs').get() as { count: number }
  return result.count
}

/**
 * Get recent logs (last N milliseconds)
 */
export function getRecentLogs(db: BetterSqlite3.Database, ms = 60000): LogEvent[] {
  const since = Date.now() - ms
  return queryLogs(db, { since, limit: 100 })
}

/**
 * Clean up old logs (retention policy)
 */
export function cleanupOldLogs(db: BetterSqlite3.Database, retentionDays = 7): number {
  const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const result = db.prepare('DELETE FROM logs WHERE timestamp < ?').run(cutoffTime)
  return result.changes
}
