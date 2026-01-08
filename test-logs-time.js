#!/usr/bin/env node
/**
 * Test script for rudi logs time filtering
 */

import { cmdLogs } from './src/commands/logs.js';

console.log('=== Testing Time Filters ===\n');

// Test --last filter
console.log('Test 1: Logs from last 10 seconds (should show all test logs)');
await cmdLogs([], { last: '10s', limit: 10 });

console.log('\n\nTest 2: Logs from last 1 minute');
await cmdLogs([], { last: '1m', limit: 10 });

console.log('\n\nTest 3: Logs from last 1 hour');
await cmdLogs([], { last: '1h', limit: 10 });

// Test count
console.log('\n\nTest 4: Total log count');
import { getLogCount } from '@learnrudi/db/logs';
import { getDb } from '@learnrudi/db';
const count = getLogCount(getDb());
console.log(`Total logs in database: ${count}`);
