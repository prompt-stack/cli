/**
 * Type declarations for schema.js
 */

import type BetterSqlite3 from 'better-sqlite3'

export const SCHEMA_VERSION: number
export const SCHEMA_SQL: string

export interface ModelPricing {
  input_cost_per_mtok: number
  output_cost_per_mtok: number
  cache_read_cost_per_mtok: number
  cache_write_cost_per_mtok: number
}

export interface UsageInfo {
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
}

export function initSchemaWithDb(db: BetterSqlite3.Database): void
export function getModelPricing(provider: string, model: string): ModelPricing | null
export function calculateCostFromPricing(provider: string, model: string, usage: UsageInfo): number
