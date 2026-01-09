/**
 * OpenAI embeddings provider
 *
 * Uses text-embedding-3-small by default (1536 dimensions, $0.02/1M tokens)
 * Supports dimension reduction via API parameter.
 */

import OpenAI from 'openai';

/**
 * @typedef {Object} EmbeddingModel
 * @property {string} name - Model name (e.g., 'text-embedding-3-small')
 * @property {number} dimensions - Output dimensions
 */

/**
 * Create OpenAI embedding provider
 * @param {Object} options
 * @param {string} [options.apiKey] - OpenAI API key (defaults to OPENAI_API_KEY env)
 * @param {string} [options.baseURL] - Custom base URL (for proxies/compatible APIs)
 * @returns {Object} Provider instance
 */
export function createOpenAIProvider(options = {}) {
  const client = new OpenAI({
    apiKey: options.apiKey || process.env.OPENAI_API_KEY,
    baseURL: options.baseURL,
  });

  return {
    id: 'openai',

    /**
     * Embed a batch of texts
     * @param {string[]} texts
     * @param {EmbeddingModel} model
     * @returns {Promise<Float32Array[]>}
     */
    async embedBatch(texts, model) {
      if (texts.length === 0) return [];

      const response = await client.embeddings.create({
        model: model.name,
        input: texts,
        dimensions: model.dimensions,
        encoding_format: 'float',
      });

      // Sort by index to preserve order (API may return out of order)
      const sorted = response.data.sort((a, b) => a.index - b.index);

      return sorted.map(d => new Float32Array(d.embedding));
    },

    /**
     * Embed a single text
     * @param {string} text
     * @param {EmbeddingModel} model
     * @returns {Promise<Float32Array>}
     */
    async embed(text, model) {
      const [result] = await this.embedBatch([text], model);
      return result;
    },
  };
}

/**
 * Default OpenAI models
 */
export const OPENAI_MODELS = {
  'text-embedding-3-small': {
    name: 'text-embedding-3-small',
    dimensions: 1536,
    maxDimensions: 1536,
    costPerMillion: 0.02,
  },
  'text-embedding-3-large': {
    name: 'text-embedding-3-large',
    dimensions: 3072,
    maxDimensions: 3072,
    costPerMillion: 0.13,
  },
};

/**
 * Get default model config
 * @returns {EmbeddingModel}
 */
export function getDefaultModel() {
  return {
    name: 'text-embedding-3-small',
    dimensions: 1536,
  };
}
