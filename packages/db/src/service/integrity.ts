/**
 * Database Integrity Checks
 *
 * Production monitoring for detecting and repairing aggregate drift.
 * Run periodically or on-demand to ensure session aggregates match actual turn data.
 */

import type BetterSqlite3 from 'better-sqlite3'
import { recomputeSessionAggregates } from './turns'

// ============================================================================
// Types
// ============================================================================

export interface IntegrityIssue {
  type: 'turn_count_mismatch' | 'cost_mismatch' | 'input_token_mismatch' | 'output_token_mismatch' | 'duration_mismatch'
  sessionId: string
  expected: number
  actual: number
}

export interface IntegrityCheckResult {
  issues: IntegrityIssue[]
  checkedAt: string
  durationMs: number
}

export interface RepairResult {
  repairedCount: number
  sessionIds: string[]
  durationMs: number
}

// ============================================================================
// Integrity Checks
// ============================================================================

/**
 * Run full integrity check on all session aggregates
 * Returns array of issues found (empty = all good)
 */
export function checkSessionAggregates(db: BetterSqlite3.Database): IntegrityCheckResult {
  const startTime = Date.now()
  const issues: IntegrityIssue[] = []

  // 1. Check turn_count
  const countMismatches = db.prepare(`
    SELECT
      s.id,
      s.turn_count as expected,
      COUNT(t.id) as actual
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE s.status != 'deleted'
    GROUP BY s.id
    HAVING s.turn_count != COUNT(t.id)
  `).all() as Array<{ id: string; expected: number; actual: number }>

  for (const row of countMismatches) {
    issues.push({
      type: 'turn_count_mismatch',
      sessionId: row.id,
      expected: row.expected,
      actual: row.actual
    })
  }

  // 2. Check total_cost
  const costMismatches = db.prepare(`
    SELECT
      s.id,
      s.total_cost as expected,
      COALESCE(SUM(t.cost), 0) as actual
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE s.status != 'deleted'
    GROUP BY s.id
    HAVING ABS(s.total_cost - COALESCE(SUM(t.cost), 0)) > 0.0001
  `).all() as Array<{ id: string; expected: number; actual: number }>

  for (const row of costMismatches) {
    issues.push({
      type: 'cost_mismatch',
      sessionId: row.id,
      expected: row.expected,
      actual: row.actual
    })
  }

  // 3. Check total_input_tokens
  const inputTokenMismatches = db.prepare(`
    SELECT
      s.id,
      s.total_input_tokens as expected,
      COALESCE(SUM(t.input_tokens), 0) as actual
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE s.status != 'deleted'
    GROUP BY s.id
    HAVING s.total_input_tokens != COALESCE(SUM(t.input_tokens), 0)
  `).all() as Array<{ id: string; expected: number; actual: number }>

  for (const row of inputTokenMismatches) {
    issues.push({
      type: 'input_token_mismatch',
      sessionId: row.id,
      expected: row.expected,
      actual: row.actual
    })
  }

  // 4. Check total_output_tokens
  const outputTokenMismatches = db.prepare(`
    SELECT
      s.id,
      s.total_output_tokens as expected,
      COALESCE(SUM(t.output_tokens), 0) as actual
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE s.status != 'deleted'
    GROUP BY s.id
    HAVING s.total_output_tokens != COALESCE(SUM(t.output_tokens), 0)
  `).all() as Array<{ id: string; expected: number; actual: number }>

  for (const row of outputTokenMismatches) {
    issues.push({
      type: 'output_token_mismatch',
      sessionId: row.id,
      expected: row.expected,
      actual: row.actual
    })
  }

  // 5. Check total_duration_ms
  const durationMismatches = db.prepare(`
    SELECT
      s.id,
      s.total_duration_ms as expected,
      COALESCE(SUM(t.duration_ms), 0) as actual
    FROM sessions s
    LEFT JOIN turns t ON t.session_id = s.id
    WHERE s.status != 'deleted'
    GROUP BY s.id
    HAVING s.total_duration_ms != COALESCE(SUM(t.duration_ms), 0)
  `).all() as Array<{ id: string; expected: number; actual: number }>

  for (const row of durationMismatches) {
    issues.push({
      type: 'duration_mismatch',
      sessionId: row.id,
      expected: row.expected,
      actual: row.actual
    })
  }

  return {
    issues,
    checkedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime
  }
}

/**
 * Repair all aggregate mismatches by recomputing from turns
 * Returns count of sessions repaired
 */
export function repairAggregates(db: BetterSqlite3.Database): RepairResult {
  const startTime = Date.now()
  const { issues } = checkSessionAggregates(db)

  if (issues.length === 0) {
    return {
      repairedCount: 0,
      sessionIds: [],
      durationMs: Date.now() - startTime
    }
  }

  // Get unique session IDs with issues
  const sessionIds = [...new Set(issues.map(i => i.sessionId))]

  // Recompute aggregates for each affected session
  for (const sessionId of sessionIds) {
    recomputeSessionAggregates(db, sessionId)
  }

  console.log(`[DbIntegrity] Repaired aggregates for ${sessionIds.length} sessions`)

  return {
    repairedCount: sessionIds.length,
    sessionIds,
    durationMs: Date.now() - startTime
  }
}

/**
 * Quick health check - returns true if no issues found
 */
export function isHealthy(db: BetterSqlite3.Database): boolean {
  const { issues } = checkSessionAggregates(db)
  return issues.length === 0
}

/**
 * Get summary stats for monitoring
 */
export function getIntegritySummary(db: BetterSqlite3.Database): {
  totalSessions: number
  totalTurns: number
  issueCount: number
  healthy: boolean
} {
  const sessionCount = db.prepare(`
    SELECT COUNT(*) as count FROM sessions WHERE status != 'deleted'
  `).get() as { count: number }

  const turnCount = db.prepare(`
    SELECT COUNT(*) as count FROM turns
  `).get() as { count: number }

  const { issues } = checkSessionAggregates(db)

  return {
    totalSessions: sessionCount.count,
    totalTurns: turnCount.count,
    issueCount: issues.length,
    healthy: issues.length === 0
  }
}
