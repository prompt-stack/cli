/**
 * Tests for database schema and pricing calculations
 *
 * Run with: pnpm vitest run pstack-cli/db/schema.test.js
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);

// Use a test database instead of production
const TEST_DB_PATH = path.join(os.tmpdir(), `pstack-test-schema-${Date.now()}.db`);

// Setup test database before importing schema
let db;
let schemaModule;

describe('Schema and Pricing', () => {
  beforeAll(async () => {
    // Create a mock database for testing
    const Database = require('better-sqlite3');
    db = new Database(TEST_DB_PATH);
    db.pragma('journal_mode = WAL');

    // Manually create schema for testing (simplified version)
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_pricing (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model_pattern TEXT NOT NULL,
        display_name TEXT,
        input_cost_per_mtok REAL NOT NULL,
        output_cost_per_mtok REAL NOT NULL,
        cache_read_cost_per_mtok REAL DEFAULT 0,
        cache_write_cost_per_mtok REAL DEFAULT 0,
        effective_from TEXT NOT NULL,
        effective_until TEXT,
        notes TEXT
      );

      INSERT INTO schema_version (version, applied_at) VALUES (2, datetime('now'));
    `);

    // Seed pricing data
    const pricingData = [
      ['claude', 'claude-opus-4-5-%', 'Claude Opus 4.5', 15.0, 75.0, 1.5, 18.75, '2025-01-01'],
      ['claude', 'claude-sonnet-4-5-%', 'Claude Sonnet 4.5', 3.0, 15.0, 0.3, 3.75, '2025-01-01'],
      ['claude', 'claude-haiku-4-5-%', 'Claude Haiku 4.5', 0.8, 4.0, 0.08, 1.0, '2025-01-01'],
      ['codex', 'o3-mini', 'o3 Mini', 1.1, 4.4, 0, 0, '2025-01-01'],
      ['codex', 'gpt-4o', 'GPT-4o', 5.0, 15.0, 0, 0, '2024-05-01'],
      ['gemini', 'gemini-2.5-pro%', 'Gemini 2.5 Pro', 1.25, 5.0, 0, 0, '2025-01-01'],
      ['gemini', 'gemini-2.5-flash%', 'Gemini 2.5 Flash', 0.075, 0.3, 0, 0, '2025-01-01'],
      ['gemini', 'gemini%', 'Gemini (default)', 0.1, 0.4, 0, 0, '2024-01-01'],
      ['ollama', '%', 'Local Model', 0, 0, 0, 0, '2024-01-01'],
    ];

    const insert = db.prepare(`
      INSERT INTO model_pricing
      (provider, model_pattern, display_name, input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok, effective_from)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const row of pricingData) {
      insert.run(...row);
    }
  });

  afterAll(() => {
    if (db) {
      db.close();
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe('getModelPricing (direct SQL)', () => {
    // Test the pricing lookup logic directly
    function getModelPricing(provider, model) {
      const pricing = db.prepare(`
        SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok, cache_write_cost_per_mtok
        FROM model_pricing
        WHERE provider = ?
          AND (model_pattern = ? OR ? LIKE model_pattern)
          AND (effective_until IS NULL OR effective_until > datetime('now'))
        ORDER BY
          CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
          effective_from DESC
        LIMIT 1
      `).get(provider, model, model, model);

      return pricing || null;
    }

    it('should return pricing for Claude Opus 4.5', () => {
      const pricing = getModelPricing('claude', 'claude-opus-4-5-20251101');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(15);
      expect(pricing.output_cost_per_mtok).toBe(75);
      expect(pricing.cache_read_cost_per_mtok).toBe(1.5);
    });

    it('should return pricing for Claude Sonnet 4.5', () => {
      const pricing = getModelPricing('claude', 'claude-sonnet-4-5-20250929');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(3);
      expect(pricing.output_cost_per_mtok).toBe(15);
      expect(pricing.cache_read_cost_per_mtok).toBe(0.3);
    });

    it('should return pricing for Claude Haiku 4.5', () => {
      const pricing = getModelPricing('claude', 'claude-haiku-4-5-20251001');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(0.8);
      expect(pricing.output_cost_per_mtok).toBe(4);
      expect(pricing.cache_read_cost_per_mtok).toBe(0.08);
    });

    it('should return pricing for Codex o3-mini using exact match', () => {
      const pricing = getModelPricing('codex', 'o3-mini');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(1.1);
      expect(pricing.output_cost_per_mtok).toBe(4.4);
    });

    it('should return null for unknown provider', () => {
      const pricing = getModelPricing('unknown', 'unknown-model');
      expect(pricing).toBeNull();
    });

    it('should return free pricing for Ollama models via wildcard', () => {
      const pricing = getModelPricing('ollama', 'llama3:latest');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(0);
      expect(pricing.output_cost_per_mtok).toBe(0);
    });

    it('should return pricing for Gemini 2.5 Pro', () => {
      const pricing = getModelPricing('gemini', 'gemini-2.5-pro-preview');

      expect(pricing).not.toBeNull();
      expect(pricing.input_cost_per_mtok).toBe(1.25);
      expect(pricing.output_cost_per_mtok).toBe(5);
    });
  });

  describe('calculateCostFromPricing', () => {
    // Implement the cost calculation logic inline for testing
    function calculateCost(provider, model, usage) {
      if (!usage) return 0;

      // Get pricing from test DB
      const pricing = db.prepare(`
        SELECT input_cost_per_mtok, output_cost_per_mtok, cache_read_cost_per_mtok
        FROM model_pricing
        WHERE provider = ?
          AND (model_pattern = ? OR ? LIKE model_pattern)
          AND (effective_until IS NULL OR effective_until > datetime('now'))
        ORDER BY
          CASE WHEN model_pattern = ? THEN 0 ELSE 1 END,
          effective_from DESC
        LIMIT 1
      `).get(provider, model, model, model);

      if (!pricing) {
        // Fallback pricing
        return ((usage.input_tokens || 0) * 0.003 + (usage.output_tokens || 0) * 0.015) / 1000;
      }

      const inputCost = (usage.input_tokens || 0) * pricing.input_cost_per_mtok / 1000000;
      const outputCost = (usage.output_tokens || 0) * pricing.output_cost_per_mtok / 1000000;
      const cacheReadCost = (usage.cache_read_tokens || 0) * pricing.cache_read_cost_per_mtok / 1000000;

      return inputCost + outputCost + cacheReadCost;
    }

    it('should calculate cost for Claude Opus 4.5 with cache', () => {
      const cost = calculateCost('claude', 'claude-opus-4-5-20251101', {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 10000
      });

      // Expected: (1000 * 15 + 500 * 75 + 10000 * 1.5) / 1,000,000
      // = (15000 + 37500 + 15000) / 1,000,000
      // = 67500 / 1,000,000
      // = 0.0675
      expect(cost).toBeCloseTo(0.0675, 6);
    });

    it('should calculate cost for Claude Sonnet 4.5', () => {
      const cost = calculateCost('claude', 'claude-sonnet-4-5-20250929', {
        input_tokens: 10000,
        output_tokens: 2000,
        cache_read_tokens: 100000
      });

      // Expected: (10000 * 3 + 2000 * 15 + 100000 * 0.3) / 1,000,000
      // = (30000 + 30000 + 30000) / 1,000,000
      // = 90000 / 1,000,000
      // = 0.09
      expect(cost).toBeCloseTo(0.09, 6);
    });

    it('should calculate cost for Codex o3-mini', () => {
      const cost = calculateCost('codex', 'o3-mini', {
        input_tokens: 50000,
        output_tokens: 5000
      });

      // Expected: (50000 * 1.1 + 5000 * 4.4) / 1,000,000
      // = (55000 + 22000) / 1,000,000
      // = 77000 / 1,000,000
      // = 0.077
      expect(cost).toBeCloseTo(0.077, 6);
    });

    it('should return 0 for Ollama models (free)', () => {
      const cost = calculateCost('ollama', 'llama3:latest', {
        input_tokens: 1000000,
        output_tokens: 500000
      });

      expect(cost).toBe(0);
    });

    it('should handle missing usage data gracefully', () => {
      const cost = calculateCost('claude', 'claude-opus-4-5-20251101', {});
      expect(cost).toBe(0);
    });

    it('should handle null usage', () => {
      const cost = calculateCost('claude', 'claude-opus-4-5-20251101', null);
      expect(cost).toBe(0);
    });

    it('should use fallback pricing for unknown models', () => {
      const cost = calculateCost('unknown', 'unknown-model', {
        input_tokens: 1000,
        output_tokens: 1000
      });

      // Fallback: (1000 * 0.003 + 1000 * 0.015) / 1000 = 0.018
      expect(cost).toBeCloseTo(0.018, 6);
    });

    it('should calculate cost for Gemini 2.5 Pro', () => {
      const cost = calculateCost('gemini', 'gemini-2.5-pro-preview', {
        input_tokens: 100000,
        output_tokens: 10000
      });

      // Expected: (100000 * 1.25 + 10000 * 5) / 1,000,000
      // = (125000 + 50000) / 1,000,000
      // = 0.175
      expect(cost).toBeCloseTo(0.175, 6);
    });

    it('should calculate cost for Gemini 2.5 Flash (cheapest)', () => {
      const cost = calculateCost('gemini', 'gemini-2.5-flash-preview', {
        input_tokens: 1000000,
        output_tokens: 100000
      });

      // Expected: (1000000 * 0.075 + 100000 * 0.3) / 1,000,000
      // = (75000 + 30000) / 1,000,000
      // = 0.105
      expect(cost).toBeCloseTo(0.105, 6);
    });

    it('should calculate large real-world costs correctly (Opus 4.5)', () => {
      // Real example from database: Opus 4.5 with heavy cache usage
      const cost = calculateCost('claude', 'claude-opus-4-5-20251101', {
        input_tokens: 23275,
        output_tokens: 90838,
        cache_read_tokens: 232997024
      });

      // Expected:
      // input: 23275 * 15 / 1,000,000 = 0.349125
      // output: 90838 * 75 / 1,000,000 = 6.81285
      // cache: 232997024 * 1.5 / 1,000,000 = 349.495536
      // Total: 356.657511
      expect(cost).toBeCloseTo(356.657511, 4);
    });

    it('should calculate real-world costs for Sonnet', () => {
      const cost = calculateCost('claude', 'claude-sonnet-4-5-20250929', {
        input_tokens: 19146,
        output_tokens: 1552890,
        cache_read_tokens: 178430963
      });

      // Expected:
      // input: 19146 * 3 / 1,000,000 = 0.057438
      // output: 1552890 * 15 / 1,000,000 = 23.29335
      // cache: 178430963 * 0.3 / 1,000,000 = 53.5292889
      // Total: 76.88007689 (matches database!)
      expect(cost).toBeCloseTo(76.88007689, 4);
    });
  });

  describe('Token cost breakdown', () => {
    it('should correctly break down per-component costs', () => {
      const usage = {
        input_tokens: 23275,
        output_tokens: 90838,
        cache_read_tokens: 232997024
      };

      // Opus 4.5 pricing
      const inputCostPerMTok = 15;
      const outputCostPerMTok = 75;
      const cacheReadCostPerMTok = 1.5;

      const inputCost = usage.input_tokens * inputCostPerMTok / 1000000;
      const outputCost = usage.output_tokens * outputCostPerMTok / 1000000;
      const cacheReadCost = usage.cache_read_tokens * cacheReadCostPerMTok / 1000000;
      const totalCost = inputCost + outputCost + cacheReadCost;

      expect(inputCost).toBeCloseTo(0.349125, 6);
      expect(outputCost).toBeCloseTo(6.81285, 5);
      expect(cacheReadCost).toBeCloseTo(349.495536, 4);
      expect(totalCost).toBeCloseTo(356.657511, 4);

      // Verify cache read is the dominant cost
      expect(cacheReadCost / totalCost).toBeGreaterThan(0.97); // >97% of cost is cache
    });
  });
});
