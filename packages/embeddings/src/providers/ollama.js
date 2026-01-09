/**
 * Ollama embeddings provider
 *
 * Local embeddings with no API key required.
 * Uses nomic-embed-text by default (768 dimensions).
 *
 * Setup:
 *   brew install ollama
 *   ollama pull nomic-embed-text
 *   ollama serve  # or it runs as a service
 */

const DEFAULT_BASE_URL = 'http://localhost:11434';

/**
 * Create Ollama embedding provider
 * @param {Object} options
 * @param {string} [options.baseURL] - Ollama server URL
 * @returns {Object} Provider instance
 */
export function createOllamaProvider(options = {}) {
  const baseURL = options.baseURL || process.env.OLLAMA_HOST || DEFAULT_BASE_URL;

  return {
    id: 'ollama',

    /**
     * Check if Ollama is available
     * @returns {Promise<boolean>}
     */
    async isAvailable() {
      try {
        const response = await fetch(`${baseURL}/api/tags`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },

    /**
     * Check if a specific model is available
     * @param {string} modelName
     * @returns {Promise<boolean>}
     */
    async hasModel(modelName) {
      try {
        const response = await fetch(`${baseURL}/api/tags`);
        if (!response.ok) return false;
        const data = await response.json();
        return data.models?.some(m => m.name === modelName || m.name.startsWith(modelName + ':'));
      } catch {
        return false;
      }
    },

    /**
     * Embed a batch of texts
     * @param {string[]} texts
     * @param {Object} model - { name, dimensions }
     * @returns {Promise<Float32Array[]>}
     */
    async embedBatch(texts, model) {
      if (texts.length === 0) return [];

      // Ollama doesn't have native batch, so we parallel fetch
      const results = await Promise.all(
        texts.map(text => this.embed(text, model))
      );

      return results;
    },

    /**
     * Embed a single text
     * @param {string} text
     * @param {Object} model - { name, dimensions }
     * @returns {Promise<Float32Array>}
     */
    async embed(text, model) {
      const response = await fetch(`${baseURL}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: model.name,
          prompt: text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Ollama error: ${error}`);
      }

      const data = await response.json();
      return new Float32Array(data.embedding);
    },
  };
}

/**
 * Available Ollama embedding models
 */
export const OLLAMA_MODELS = {
  'nomic-embed-text': {
    name: 'nomic-embed-text',
    dimensions: 768,
    description: 'Good quality, 768 dimensions, fast',
  },
  'mxbai-embed-large': {
    name: 'mxbai-embed-large',
    dimensions: 1024,
    description: 'Higher quality, 1024 dimensions',
  },
  'all-minilm': {
    name: 'all-minilm',
    dimensions: 384,
    description: 'Fastest, 384 dimensions, lower quality',
  },
};
