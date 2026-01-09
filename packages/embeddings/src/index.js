/**
 * @learnrudi/embeddings
 *
 * Semantic search and embeddings for RUDI sessions.
 *
 * Usage (CLI):
 *   import { createClient, createOpenAIProvider, getDefaultModel } from '@learnrudi/embeddings';
 *
 *   const provider = createOpenAIProvider();
 *   const model = getDefaultModel();
 *   const client = createClient({ provider, model });
 *
 *   // Index all turns
 *   await client.indexMissing({ onProgress: console.log });
 *
 *   // Search
 *   const results = await client.search('authentication bugs');
 *
 * Usage (MCP):
 *   Same client, just wrap in tool handlers.
 */

// Client
export { createClient } from './client.js';

// Provider auto-detection (preferred)
export { autoDetectProvider, getProvider } from './providers/index.js';

// Individual providers
export { createOpenAIProvider, getDefaultModel, OPENAI_MODELS } from './providers/openai.js';
export { createOllamaProvider, OLLAMA_MODELS } from './providers/ollama.js';
export { createLocalProvider, LOCAL_MODELS } from './providers/local.js';

// Store (for direct access if needed)
export * as store from './stores/sqlite.js';

// Setup helpers
export { checkProviderStatus, getSetupInstructions, autoSetupOllama } from './setup.js';

// Utils
export { sha256 } from './utils/hash.js';
export { l2Normalize, dot, cosineSimilarity, float32ToBuffer, bufferToFloat32 } from './utils/vector.js';
