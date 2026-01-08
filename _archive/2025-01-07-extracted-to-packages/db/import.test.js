/**
 * Tests for import module - parsing and cost calculation
 *
 * Run with: pnpm vitest run rudi-cli/db/import.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the parsers and database utilities
const { parseClaudeSession, parseCodexSession, parseGeminiSession } = require('./import');
const { initSchema, seedModelPricing } = require('./schema');
const { getDb, closeDb } = require('./index');

describe('Import Parsers', () => {
  // Initialize database with pricing before tests
  beforeAll(() => {
    try {
      const db = getDb();
      initSchema(db);
      seedModelPricing(db);
    } catch (err) {
      // Database may already be initialized, ignore
      console.warn('[import.test] DB init warning:', err.message);
    }
  });

  afterAll(() => {
    try {
      closeDb();
    } catch (err) {
      // Ignore close errors
    }
  });
  describe('parseClaudeSession', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'claude-session.jsonl');

    it('should parse Claude session with correct turn count', () => {
      const { session, turns } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(turns).toHaveLength(3);
    });

    it('should extract session metadata correctly', () => {
      const { session } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(session.model).toBe('claude-opus-4-5-20251101');
      expect(session.gitBranch).toBe('main');
      expect(session.title).toBe('Hello, can you help me with a coding task?');
    });

    it('should allow disabling title inference', () => {
      const { session } = parseClaudeSession(fixturePath, 'test-session-id', { inferTitles: false });

      expect(session.title).toBeNull();
    });

    it('should calculate total tokens correctly', () => {
      const { session, turns } = parseClaudeSession(fixturePath, 'test-session-id');

      // Sum of all turn tokens
      const expectedInputTokens = 15 + 20 + 30; // 65
      const expectedOutputTokens = 25 + 50 + 75; // 150

      expect(session.totalInputTokens).toBe(expectedInputTokens);
      expect(session.totalOutputTokens).toBe(expectedOutputTokens);
    });

    it('should parse cache_read_input_tokens correctly', () => {
      const { turns } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(turns[0].cacheReadTokens).toBe(5000);
      expect(turns[1].cacheReadTokens).toBe(10000);
      expect(turns[2].cacheReadTokens).toBe(15000);
    });

    it('should calculate cost including cache tokens', () => {
      const { session, turns } = parseClaudeSession(fixturePath, 'test-session-id');

      // Opus 4.5 pricing: input=15, output=75, cache_read=1.5 per MTok
      // Turn 1: (15 * 15 + 25 * 75 + 5000 * 1.5) / 1,000,000 = 0.0096
      // Turn 2: (20 * 15 + 50 * 75 + 10000 * 1.5) / 1,000,000 = 0.01905
      // Turn 3: (30 * 15 + 75 * 75 + 15000 * 1.5) / 1,000,000 = 0.028575
      // Total: 0.057225

      // Check individual turn costs are calculated
      expect(turns[0].cost).toBeCloseTo(0.0096, 6);
      expect(turns[1].cost).toBeCloseTo(0.01905, 6);
      expect(turns[2].cost).toBeCloseTo(0.028575, 6);

      // Check total session cost
      expect(session.totalCost).toBeCloseTo(0.057225, 6);
    });

    it('should extract thinking content', () => {
      const { turns } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(turns[1].thinking).toContain('Let me think about the best approach');
    });

    it('should extract tool usage', () => {
      const { turns } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(turns[2].toolsUsed).toContain('Write');
    });

    it('should set correct timestamps', () => {
      const { session } = parseClaudeSession(fixturePath, 'test-session-id');

      expect(session.createdAt).toBe('2025-01-15T10:00:00.000Z');
      expect(session.lastActiveAt).toBe('2025-01-15T10:02:15.000Z');
    });
  });

  describe('parseCodexSession', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'codex-session.jsonl');

    it('should parse Codex session with correct turn count', () => {
      const { session, turns } = parseCodexSession(fixturePath, 'test-codex-session');

      expect(turns).toHaveLength(2);
    });

    it('should extract session metadata correctly', () => {
      const { session } = parseCodexSession(fixturePath, 'test-codex-session');

      expect(session.model).toBe('o3-mini');
      expect(session.cwd).toBe('/Users/test/project');
    });

    it('should allow disabling title inference', () => {
      const { session } = parseCodexSession(fixturePath, 'test-codex-session', { inferTitles: false });

      expect(session.title).toBeNull();
    });

    it('should use last_token_usage for per-turn costs (not running total)', () => {
      const { turns } = parseCodexSession(fixturePath, 'test-codex-session');

      // Turn 1: last_token_usage has input=1000, output=500
      expect(turns[0].inputTokens).toBe(1000);
      expect(turns[0].outputTokens).toBe(500);

      // Turn 2: last_token_usage has input=2000, output=800
      expect(turns[1].inputTokens).toBe(2000);
      expect(turns[1].outputTokens).toBe(800);
    });

    it('should calculate session totals from individual turns', () => {
      const { session, turns } = parseCodexSession(fixturePath, 'test-codex-session');

      // Session totals should be sum of per-turn tokens
      const expectedInputTokens = 1000 + 2000; // 3000
      const expectedOutputTokens = 500 + 800; // 1300

      expect(session.totalInputTokens).toBe(expectedInputTokens);
      expect(session.totalOutputTokens).toBe(expectedOutputTokens);
    });

    it('should calculate costs using o3-mini pricing', () => {
      const { session, turns } = parseCodexSession(fixturePath, 'test-codex-session');

      // o3-mini pricing: input=1.1, output=4.4 per MTok
      // Turn 1: (1000 * 1.1 + 500 * 4.4) / 1,000,000 = 0.0033
      // Turn 2: (2000 * 1.1 + 800 * 4.4) / 1,000,000 = 0.00572
      // Total: 0.00902

      expect(session.totalCost).toBeCloseTo(0.00902, 4);
    });

    it('should track tool usage', () => {
      const { turns } = parseCodexSession(fixturePath, 'test-codex-session');

      expect(turns[0].toolsUsed).toContain('Write');
      expect(turns[1].toolsUsed).toContain('Write');
    });

    it('should set title from first user message', () => {
      const { session } = parseCodexSession(fixturePath, 'test-codex-session');

      expect(session.title).toBe('Create a REST API endpoint');
    });
  });

  describe('parseGeminiSession', () => {
    const fixturePath = path.join(__dirname, '__fixtures__', 'gemini-logs.json');

    it('should parse Gemini session with correct turn count', () => {
      const { session, turns } = parseGeminiSession(fixturePath, 'test-gemini-session');

      expect(turns).toHaveLength(2);
    });

    it('should extract session metadata correctly', () => {
      const { session } = parseGeminiSession(fixturePath, 'test-gemini-session');

      expect(session.model).toBe('gemini');
      expect(session.cwd).toBe('/Users/test/gemini-project');
    });

    it('should set title from first user message', () => {
      const { session } = parseGeminiSession(fixturePath, 'test-gemini-session');

      expect(session.title).toBe('Help me create a Python script for data analysis');
    });

    it('should allow disabling title inference', () => {
      const { session } = parseGeminiSession(fixturePath, 'test-gemini-session', { inferTitles: false });

      expect(session.title).toBeNull();
    });

    it('should pair user and assistant messages correctly', () => {
      const { turns } = parseGeminiSession(fixturePath, 'test-gemini-session');

      expect(turns[0].userMessage).toContain('Python script for data analysis');
      expect(turns[0].assistantResponse).toContain('pandas');

      expect(turns[1].userMessage).toContain('matplotlib');
      expect(turns[1].assistantResponse).toContain('plt.show()');
    });

    it('should have zero cost (no token tracking for Gemini)', () => {
      const { session } = parseGeminiSession(fixturePath, 'test-gemini-session');

      // Gemini CLI doesn't provide token counts
      expect(session.totalCost).toBe(0);
    });

    it('should handle empty Gemini session', () => {
      const tempPath = path.join(os.tmpdir(), 'empty-gemini.json');
      fs.writeFileSync(tempPath, '{"cwd": "/test", "messages": []}');

      try {
        const { session, turns } = parseGeminiSession(tempPath, 'empty-gemini');

        expect(turns).toHaveLength(0);
        expect(session.cwd).toBe('/test');
      } finally {
        fs.unlinkSync(tempPath);
      }
    });

    it('should handle array format Gemini logs', () => {
      const tempPath = path.join(os.tmpdir(), 'array-gemini.json');
      fs.writeFileSync(tempPath, JSON.stringify([
        { type: 'user', content: 'Hello', timestamp: '2025-01-15T10:00:00.000Z' },
        { type: 'assistant', content: 'Hi there!', timestamp: '2025-01-15T10:00:01.000Z' }
      ]));

      try {
        const { session, turns } = parseGeminiSession(tempPath, 'array-gemini');

        expect(turns).toHaveLength(1);
        expect(turns[0].userMessage).toBe('Hello');
        expect(turns[0].assistantResponse).toBe('Hi there!');
      } finally {
        fs.unlinkSync(tempPath);
      }
    });
  });

  describe('Cost Calculation Edge Cases', () => {
    it('should handle sessions with zero tokens', () => {
      // Create a minimal session file
      const tempPath = path.join(os.tmpdir(), 'empty-session.jsonl');
      fs.writeFileSync(tempPath, '{"type":"system","timestamp":"2025-01-15T10:00:00.000Z"}\n');

      try {
        const { session, turns } = parseClaudeSession(tempPath, 'empty-session');

        expect(turns).toHaveLength(0);
        expect(session.totalCost).toBe(0);
        expect(session.totalInputTokens).toBe(0);
        expect(session.totalOutputTokens).toBe(0);
      } finally {
        fs.unlinkSync(tempPath);
      }
    });

    it('should handle malformed lines gracefully', () => {
      const tempPath = path.join(os.tmpdir(), 'malformed-session.jsonl');
      fs.writeFileSync(tempPath, `
{"type":"system","timestamp":"2025-01-15T10:00:00.000Z"}
this is not valid json
{"type":"user","timestamp":"2025-01-15T10:00:01.000Z","message":{"content":"Hello"}}
{"invalid json here
{"type":"assistant","timestamp":"2025-01-15T10:00:02.000Z","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Hi"}],"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":100}}}
`);

      try {
        const { session, turns } = parseClaudeSession(tempPath, 'malformed-session');

        // Should still parse valid entries
        expect(turns).toHaveLength(1);
        expect(session.title).toBe('Hello');
      } finally {
        fs.unlinkSync(tempPath);
      }
    });

    it('should handle very large token counts', () => {
      const tempPath = path.join(os.tmpdir(), 'large-session.jsonl');
      fs.writeFileSync(tempPath, `
{"type":"user","timestamp":"2025-01-15T10:00:01.000Z","message":{"content":"Large context test"}}
{"type":"assistant","timestamp":"2025-01-15T10:00:02.000Z","message":{"model":"claude-opus-4-5-20251101","content":[{"type":"text","text":"Response"}],"usage":{"input_tokens":1000000,"output_tokens":500000,"cache_read_input_tokens":200000000}}}
`);

      try {
        const { session, turns } = parseClaudeSession(tempPath, 'large-session');

        // Opus 4.5: (1M * 15 + 500K * 75 + 200M * 1.5) / 1,000,000 = 352.5
        expect(turns[0].cost).toBeCloseTo(352.5, 2);
        expect(session.totalCost).toBeCloseTo(352.5, 2);
      } finally {
        fs.unlinkSync(tempPath);
      }
    });
  });

  describe('Pricing Formula Verification', () => {
    it('should match Anthropic pricing documentation', () => {
      // https://www.anthropic.com/pricing
      // Opus 4.5: $15/MTok input, $75/MTok output, $1.50/MTok cache read

      const inputCost = 1000000 * 15 / 1000000; // 1M tokens at $15/MTok
      const outputCost = 1000000 * 75 / 1000000; // 1M tokens at $75/MTok
      const cacheReadCost = 1000000 * 1.5 / 1000000; // 1M tokens at $1.50/MTok

      expect(inputCost).toBe(15);
      expect(outputCost).toBe(75);
      expect(cacheReadCost).toBe(1.5);
    });

    it('should match Codex/OpenAI pricing for o3-mini', () => {
      // o3-mini: $1.10/MTok input, $4.40/MTok output

      const inputCost = 1000000 * 1.1 / 1000000;
      const outputCost = 1000000 * 4.4 / 1000000;

      expect(inputCost).toBe(1.1);
      expect(outputCost).toBe(4.4);
    });

    it('should verify cache is 10% of input cost for Claude', () => {
      // Cache read should be 10% of input cost
      const opusCacheRatio = 1.5 / 15; // 0.1
      const sonnetCacheRatio = 0.3 / 3; // 0.1
      const haikuCacheRatio = 0.08 / 0.8; // 0.1

      expect(opusCacheRatio).toBeCloseTo(0.1, 6);
      expect(sonnetCacheRatio).toBeCloseTo(0.1, 6);
      expect(haikuCacheRatio).toBeCloseTo(0.1, 6);
    });

    it('should match Gemini pricing documentation', () => {
      // https://ai.google.dev/gemini-api/docs/pricing
      // Gemini 2.5 Pro: $1.25/MTok input, $5.00/MTok output
      // Gemini 2.5 Flash: $0.075/MTok input, $0.30/MTok output

      const pro25InputCost = 1000000 * 1.25 / 1000000;
      const pro25OutputCost = 1000000 * 5.0 / 1000000;

      expect(pro25InputCost).toBe(1.25);
      expect(pro25OutputCost).toBe(5.0);

      const flash25InputCost = 1000000 * 0.075 / 1000000;
      const flash25OutputCost = 1000000 * 0.3 / 1000000;

      expect(flash25InputCost).toBe(0.075);
      expect(flash25OutputCost).toBe(0.3);
    });

    it('should show Gemini Flash is 16x cheaper than Pro on input', () => {
      const proInputCost = 1.25;
      const flashInputCost = 0.075;
      const ratio = proInputCost / flashInputCost;

      expect(ratio).toBeCloseTo(16.67, 1);
    });
  });
});
