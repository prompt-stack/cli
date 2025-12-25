#!/usr/bin/env node
/**
 * Test script for pstack logs export functionality
 */

import { cmdLogs } from './src/commands/logs.js';
import fs from 'fs';

// Test export formats
console.log('=== Testing Export Formats ===\n');

// JSON export
console.log('Test 1: Exporting to JSON...');
await cmdLogs([], { export: '/tmp/test-logs.json', format: 'json', limit: 5 });

// NDJSON export
console.log('\nTest 2: Exporting to NDJSON...');
await cmdLogs([], { export: '/tmp/test-logs.ndjson', format: 'ndjson', limit: 5 });

// CSV export
console.log('\nTest 3: Exporting to CSV...');
await cmdLogs([], { export: '/tmp/test-logs.csv', format: 'csv', limit: 5 });

// Verify exports
console.log('\n=== Verifying Exports ===\n');

console.log('JSON export preview:');
console.log(fs.readFileSync('/tmp/test-logs.json', 'utf-8').substring(0, 200) + '...\n');

console.log('NDJSON export preview:');
console.log(fs.readFileSync('/tmp/test-logs.ndjson', 'utf-8').split('\n').slice(0, 2).join('\n') + '\n');

console.log('CSV export preview:');
console.log(fs.readFileSync('/tmp/test-logs.csv', 'utf-8').split('\n').slice(0, 3).join('\n'));
