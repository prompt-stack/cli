/**
 * Local embeddings provider (stub)
 *
 * For privacy-first users who don't want to send data to OpenAI.
 * Will use ONNX runtime with sentence-transformers models.
 *
 * TODO: Implement with @xenova/transformers or onnxruntime-node
 */

/**
 * @typedef {Object} EmbeddingModel
 * @property {string} name - Model name
 * @property {number} dimensions - Output dimensions
 */

/**
 * Create local embedding provider
 * @returns {Object} Provider instance
 */
export function createLocalProvider() {
  return {
    id: 'local',

    /**
     * Embed a batch of texts
     * @param {string[]} texts
     * @param {EmbeddingModel} model
     * @returns {Promise<Float32Array[]>}
     */
    async embedBatch(texts, model) {
      // TODO: Implement with ONNX runtime
      throw new Error(
        'Local embeddings not yet implemented. ' +
        'Install with: rudi install local-embeddings\n' +
        'For now, use OpenAI: rudi config set embeddings.provider openai'
      );
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
 * Local model options (for future implementation)
 */
export const LOCAL_MODELS = {
  'all-MiniLM-L6-v2': {
    name: 'all-MiniLM-L6-v2',
    dimensions: 384,
    description: 'Fast, good quality, 384 dimensions',
  },
  'all-mpnet-base-v2': {
    name: 'all-mpnet-base-v2',
    dimensions: 768,
    description: 'Higher quality, 768 dimensions',
  },
  'bge-small-en-v1.5': {
    name: 'bge-small-en-v1.5',
    dimensions: 384,
    description: 'BAAI general embedding, fast',
  },
};
