#!/usr/bin/env node
/**
 * Test script for pstack logs command
 */

import { cmdLogs } from './src/commands/logs.js';

// Test 1: Basic logs
console.log('=== Test 1: Basic logs (default) ===\n');
await cmdLogs([], { limit: 10 });

console.log('\n\n=== Test 2: Filter by level (error) ===\n');
await cmdLogs([], { level: 'error', limit: 10 });

console.log('\n\n=== Test 3: Filter by source (agent-claude) ===\n');
await cmdLogs([], { source: 'agent-claude', limit: 10 });

console.log('\n\n=== Test 4: Slow operations only ===\n');
await cmdLogs([], { 'slow-only': true, 'slow-threshold': 1000, limit: 10 });

console.log('\n\n=== Test 5: Filter by provider (claude) ===\n');
await cmdLogs([], { provider: 'claude', limit: 10 });

console.log('\n\n=== Test 6: Search for text ===\n');
await cmdLogs([], { filter: 'completion', limit: 10 });

console.log('\n\n=== Test 7: Statistics ===\n');
await cmdLogs([], { stats: true });

console.log('\n\n=== Test 8: JSON output ===\n');
await cmdLogs([], { json: true, limit: 3 });

console.log('\n\n=== Test 9: Verbose output ===\n');
await cmdLogs([], { verbose: true, limit: 2 });
