/**
 * rudi logs - Observability logs command
 *
 * Query and export agent visibility logs for debugging and support
 */

import { queryLogs, getLogStats, getBeforeCrashLogs, getLogCount } from '@learnrudi/db/logs';
import fs from 'fs';
import path from 'path';

/**
 * Parse time duration strings (5m, 1h, 30s) to milliseconds
 */
function parseTimeAgo(str) {
  const match = str.match(/^(\d+)([smhd])$/);
  if (!match) return null;

  const [, num, unit] = match;
  const value = parseInt(num);

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}

/**
 * Parse ISO timestamp or relative time
 */
function parseTimestamp(str) {
  if (!str) return null;

  // Try relative time first (5m, 1h, etc)
  const relative = parseTimeAgo(str);
  if (relative) {
    return Date.now() - relative;
  }

  // Try ISO timestamp
  const date = new Date(str);
  if (!isNaN(date.getTime())) {
    return date.getTime();
  }

  return null;
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ts) {
  const date = new Date(ts);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format log event for console output
 */
function formatLogEvent(event, options = {}) {
  const { verbose = false, json = false } = options;

  if (json) {
    const parsed = JSON.parse(event.data_json);
    return JSON.stringify({
      timestamp: event.timestamp,
      source: event.source,
      level: event.level,
      type: event.type,
      ...parsed
    });
  }

  const time = formatTimestamp(event.timestamp);
  const source = event.source.padEnd(10);
  const level = event.level.toUpperCase().padEnd(5);

  const parsed = JSON.parse(event.data_json);
  const message = parsed.message || parsed.channel || event.type;

  let output = `\x1b[90m${time}\x1b[0m \x1b[36m[${source}]\x1b[0m ${message}`;

  if (event.duration_ms) {
    output += ` \x1b[33m(${event.duration_ms}ms)\x1b[0m`;
  }

  if (verbose) {
    output += `\n  Type: ${event.type}`;
    if (event.provider) output += ` | Provider: ${event.provider}`;
    if (event.cid) output += ` | CID: ${event.cid}`;
  }

  return output;
}

/**
 * Export logs to file
 */
function exportLogs(logs, filepath, format) {
  let content;

  switch (format) {
    case 'ndjson':
      content = logs.map(e => {
        const parsed = JSON.parse(e.data_json);
        return JSON.stringify({
          timestamp: e.timestamp,
          source: e.source,
          level: e.level,
          type: e.type,
          ...parsed
        });
      }).join('\n');
      break;

    case 'csv':
      const headers = 'timestamp,source,level,type,message,duration_ms\n';
      const rows = logs.map(e => {
        const parsed = JSON.parse(e.data_json);
        const message = (parsed.message || parsed.channel || e.type).replace(/"/g, '""');
        return `${e.timestamp},${e.source},${e.level},${e.type},"${message}",${e.duration_ms || ''}`;
      }).join('\n');
      content = headers + rows;
      break;

    case 'json':
    default:
      const formatted = logs.map(e => {
        const parsed = JSON.parse(e.data_json);
        return {
          timestamp: e.timestamp,
          source: e.source,
          level: e.level,
          type: e.type,
          ...parsed
        };
      });
      content = JSON.stringify(formatted, null, 2);
  }

  fs.writeFileSync(filepath, content, 'utf-8');
  return filepath;
}

/**
 * Print stats summary
 */
function printStats(stats) {
  console.log('\n\x1b[1mLog Statistics\x1b[0m\n');

  console.log(`Total events: ${stats.total}`);

  if (Object.keys(stats.bySource).length > 0) {
    console.log('\n\x1b[1mBy Source:\x1b[0m');
    Object.entries(stats.bySource)
      .sort((a, b) => b[1] - a[1])
      .forEach(([source, count]) => {
        console.log(`  ${source.padEnd(15)} ${count} events`);
      });
  }

  if (Object.keys(stats.byLevel).length > 0) {
    console.log('\n\x1b[1mBy Level:\x1b[0m');
    const levelColors = {
      error: '\x1b[31m',
      warn: '\x1b[33m',
      info: '\x1b[36m',
      debug: '\x1b[90m'
    };
    Object.entries(stats.byLevel).forEach(([level, count]) => {
      const color = levelColors[level] || '';
      console.log(`  ${color}${level.padEnd(8)}\x1b[0m ${count} events`);
    });
  }

  if (Object.keys(stats.byProvider).length > 0) {
    console.log('\n\x1b[1mBy Provider:\x1b[0m');
    Object.entries(stats.byProvider)
      .sort((a, b) => b[1] - a[1])
      .forEach(([provider, count]) => {
        console.log(`  ${provider.padEnd(12)} ${count} events`);
      });
  }

  if (stats.slowest.length > 0) {
    console.log('\n\x1b[1mSlowest Operations:\x1b[0m');
    stats.slowest.forEach((op, i) => {
      console.log(`  ${i + 1}. ${op.operation.padEnd(30)} ${op.avgMs}ms avg (${op.count} calls, max: ${op.maxMs}ms)`);
    });
  }

  console.log('');
}

/**
 * Main logs command handler
 */
async function handleLogsCommand(args, flags) {
  const {
    limit,
    last,
    since,
    until,
    filter,
    source,
    level,
    type,
    provider,
    'session-id': sessionId,
    'terminal-id': terminalId,
    'slow-only': slowOnly,
    'slow-threshold': slowThreshold,
    'before-crash': beforeCrash,
    stats,
    export: exportPath,
    format = 'json',
    verbose,
    json
  } = flags;

  // Stats mode
  if (stats) {
    const options = {};

    if (last) options.since = Date.now() - parseTimeAgo(last);
    if (since) options.since = parseTimestamp(since);
    if (until) options.until = parseTimestamp(until);
    if (filter) options.search = filter;

    const statsData = getLogStats(options);
    printStats(statsData);
    return;
  }

  // Query logs
  const options = {
    limit: parseInt(limit) || 50,
    source,
    level,
    type,
    provider,
    sessionId,
    terminalId: terminalId ? parseInt(terminalId) : undefined,
    slowOnly: !!slowOnly,
    slowThreshold: slowThreshold ? parseInt(slowThreshold) : 1000
  };

  // Time filters
  if (beforeCrash) {
    const crashLogs = getBeforeCrashLogs();
    console.log(`\n\x1b[33mLast ${crashLogs.length} events before crash:\x1b[0m\n`);
    crashLogs.forEach(e => console.log(formatLogEvent(e, { verbose, json })));
    return;
  }

  if (last) {
    options.since = Date.now() - parseTimeAgo(last);
  }
  if (since) {
    options.since = parseTimestamp(since);
  }
  if (until) {
    options.until = parseTimestamp(until);
  }

  // Text search (repeatable --filter flags)
  if (filter) {
    if (Array.isArray(filter)) {
      // Multiple filters: join with AND logic
      options.search = filter.join(' ');
    } else {
      options.search = filter;
    }
  }

  const logs = queryLogs(options);

  // Export to file
  if (exportPath) {
    const filepath = exportLogs(logs, exportPath, format);
    console.log(`\n✅ Exported ${logs.length} logs to: ${filepath}\n`);
    return;
  }

  // Console output
  if (logs.length === 0) {
    console.log('\nNo logs found matching filters.\n');
    return;
  }

  console.log(`\n\x1b[90mShowing ${logs.length} logs:\x1b[0m\n`);
  logs.forEach(e => console.log(formatLogEvent(e, { verbose, json })));
  console.log('');
}

export { handleLogsCommand as cmdLogs };
