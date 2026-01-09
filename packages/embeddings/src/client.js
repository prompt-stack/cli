/**
 * Embeddings client - orchestrates indexing and search
 *
 * This is the main entry point for both CLI and MCP.
 */

import { sha256 } from './utils/hash.js';
import { l2Normalize, dot, float32ToBuffer, bufferToFloat32 } from './utils/vector.js';
import * as store from './stores/sqlite.js';

/**
 * @typedef {Object} EmbeddingModel
 * @property {string} name
 * @property {number} dimensions
 */

/**
 * @typedef {Object} SearchResult
 * @property {number} score - Cosine similarity (0-1)
 * @property {Object} turn - Turn data
 */

/**
 * Create an embeddings client
 * @param {Object} options
 * @param {Object} options.provider - Embedding provider instance
 * @param {EmbeddingModel} options.model - Model config
 * @returns {Object} Client instance
 */
export function createClient({ provider, model }) {
  // Ensure schema exists
  store.ensureEmbeddingsSchema();

  return {
    provider,
    model,

    /**
     * Index missing turns (batch)
     * @param {Object} options
     * @param {number} [options.batchSize=64] - Turns per API call
     * @param {number} [options.maxTurns=Infinity] - Maximum turns to index
     * @param {function} [options.onProgress] - Progress callback
     * @returns {Promise<{indexed: number, errors: number}>}
     */
    async indexMissing(options = {}) {
      const batchSize = options.batchSize ?? 64;
      const maxTurns = options.maxTurns ?? Infinity;
      const onProgress = options.onProgress ?? (() => {});

      let indexed = 0;
      let errors = 0;

      while (indexed < maxTurns) {
        const turns = store.getMissingTurns(model, Math.min(batchSize, maxTurns - indexed));
        if (turns.length === 0) break;

        const texts = turns.map(t => t.content.trim().replace(/\n+/g, ' '));

        try {
          const vectors = await provider.embedBatch(texts, model);

          for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];
            const normalized = l2Normalize(vectors[i]);

            store.upsertEmbedding({
              turn_id: turn.id,
              model: model.name,
              dimensions: model.dimensions,
              embedding: float32ToBuffer(normalized),
              content_hash: sha256(turn.content),
              status: 'done',
              error: null,
            });

            indexed++;
            onProgress({ indexed, errors, current: turn });
          }
        } catch (err) {
          // Mark batch as error
          const msg = err?.message ?? String(err);
          for (const turn of turns) {
            store.upsertEmbedding({
              turn_id: turn.id,
              model: model.name,
              dimensions: model.dimensions,
              embedding: Buffer.alloc(0),
              content_hash: sha256(turn.content),
              status: 'error',
              error: msg,
            });
            errors++;
          }
          onProgress({ indexed, errors, error: msg });

          // Rethrow to let caller decide whether to continue
          throw err;
        }
      }

      return { indexed, errors };
    },

    /**
     * Retry failed embeddings
     * @param {Object} options
     * @returns {Promise<{indexed: number, errors: number}>}
     */
    async retryErrors(options = {}) {
      const batchSize = options.batchSize ?? 64;
      const onProgress = options.onProgress ?? (() => {});

      let indexed = 0;
      let errors = 0;

      while (true) {
        const turns = store.getErrorTurns(model, batchSize);
        if (turns.length === 0) break;

        const texts = turns.map(t => t.content.trim().replace(/\n+/g, ' '));

        try {
          const vectors = await provider.embedBatch(texts, model);

          for (let i = 0; i < turns.length; i++) {
            const turn = turns[i];
            const normalized = l2Normalize(vectors[i]);

            store.upsertEmbedding({
              turn_id: turn.id,
              model: model.name,
              dimensions: model.dimensions,
              embedding: float32ToBuffer(normalized),
              content_hash: sha256(turn.content),
              status: 'done',
              error: null,
            });

            indexed++;
            onProgress({ indexed, errors, current: turn });
          }
        } catch (err) {
          errors += turns.length;
          throw err;
        }
      }

      return { indexed, errors };
    },

    /**
     * Semantic search across all turns
     * @param {string} query
     * @param {Object} options
     * @param {number} [options.limit=10]
     * @returns {Promise<SearchResult[]>}
     */
    async search(query, options = {}) {
      const limit = options.limit ?? 10;

      // Embed the query
      const queryVec = await provider.embed(query.trim().replace(/\n+/g, ' '), model);
      const queryNorm = l2Normalize(queryVec);

      // Brute-force search (fast enough for <50K)
      const top = [];

      for (const row of store.iterEmbeddings(model)) {
        const embedding = bufferToFloat32(row.embedding);
        const score = dot(queryNorm, embedding);

        if (top.length < limit) {
          top.push({ turn_id: row.turn_id, score });
          top.sort((a, b) => b.score - a.score);
        } else if (score > top[top.length - 1].score) {
          top[top.length - 1] = { turn_id: row.turn_id, score };
          top.sort((a, b) => b.score - a.score);
        }
      }

      // Hydrate with turn data
      const turns = store.getTurnsByIds(top.map(t => t.turn_id));
      const byId = new Map(turns.map(t => [t.id, t]));

      return top
        .map(t => ({
          score: t.score,
          turn: byId.get(t.turn_id),
        }))
        .filter(r => r.turn);
    },

    /**
     * Find turns similar to a given turn
     * @param {string} turnId
     * @param {Object} options
     * @returns {Promise<SearchResult[]>}
     */
    async findSimilar(turnId, options = {}) {
      const turn = store.getTurnById(turnId);
      if (!turn) return [];

      const results = await this.search(turn.content, {
        ...options,
        limit: (options.limit ?? 10) + 1, // +1 to exclude self
      });

      // Exclude the source turn
      return results.filter(r => r.turn.id !== turnId).slice(0, options.limit ?? 10);
    },

    /**
     * Get indexing stats
     * @returns {Object}
     */
    getStats() {
      return store.getEmbeddingStats(model);
    },

    /**
     * Clear all embeddings for current model
     */
    clearAll() {
      store.clearEmbeddings(model);
    },
  };
}
