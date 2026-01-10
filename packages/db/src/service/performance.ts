/**
 * Lightweight performance helpers for DB instrumentation.
 *
 * Keeps the shared DB service decoupled from Electron-specific code.
 */

const ENABLED = process.env.RUDI_PERF_INSTRUMENTATION === '1'

export function logSqlitePragmas(db: any): void {
  if (!ENABLED) return

  try {
    const pragmas = {
      journal_mode: db.pragma('journal_mode', { simple: true }),
      synchronous: db.pragma('synchronous', { simple: true }),
      wal_autocheckpoint: db.pragma('wal_autocheckpoint', { simple: true }),
      cache_size: db.pragma('cache_size', { simple: true }),
      page_size: db.pragma('page_size', { simple: true }),
      mmap_size: db.pragma('mmap_size', { simple: true }),
    }

    const syncNames: Record<number, string> = {
      0: 'OFF',
      1: 'NORMAL',
      2: 'FULL',
      3: 'EXTRA',
    }
    const syncValue = pragmas.synchronous as number
    const syncName = syncNames[syncValue] || `UNKNOWN(${syncValue})`

    console.log('[PerfInstrumentation] SQLite pragmas:', {
      ...pragmas,
      synchronous_name: syncName,
    })
  } catch (err) {
    console.error('[PerfInstrumentation] Failed to read SQLite pragmas:', err)
  }
}
