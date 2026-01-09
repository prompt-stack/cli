/**
 * Provider auto-detection and factory
 *
 * Priority:
 * 1. Ollama (if running locally)
 * 2. OpenAI (if OPENAI_API_KEY set)
 * 3. Error with helpful message
 */

import { createOpenAIProvider } from './openai.js';
import { createOllamaProvider } from './ollama.js';

/**
 * Auto-detect the best available provider
 * @returns {Promise<{provider: Object, model: Object}>}
 */
export async function autoDetectProvider() {
  // 1. Try Ollama first (local, no key needed)
  try {
    const ollama = createOllamaProvider();
    const available = await ollama.isAvailable();
    if (available) {
      return {
        provider: ollama,
        model: { name: 'nomic-embed-text', dimensions: 768 },
      };
    }
  } catch {
    // Ollama not available, continue
  }

  // 2. Try OpenAI if key exists
  if (process.env.OPENAI_API_KEY) {
    return {
      provider: createOpenAIProvider(),
      model: { name: 'text-embedding-3-small', dimensions: 1536 },
    };
  }

  // 3. No provider available
  throw new Error(
    'No embedding provider available.\n\n' +
    'Options:\n' +
    '  1. Install Ollama and run: ollama pull nomic-embed-text\n' +
    '  2. Set OPENAI_API_KEY environment variable\n' +
    '  3. Specify provider: --provider ollama|openai\n'
  );
}

/**
 * Get provider by name
 * @param {string} name - 'auto', 'ollama', 'openai'
 * @returns {Promise<{provider: Object, model: Object}>}
 */
export async function getProvider(name = 'auto') {
  switch (name) {
    case 'auto':
      return autoDetectProvider();

    case 'ollama':
      const ollama = createOllamaProvider();
      return {
        provider: ollama,
        model: { name: 'nomic-embed-text', dimensions: 768 },
      };

    case 'openai':
      if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY required for OpenAI provider');
      }
      return {
        provider: createOpenAIProvider(),
        model: { name: 'text-embedding-3-small', dimensions: 1536 },
      };

    default:
      throw new Error(`Unknown provider: ${name}. Use: auto, ollama, openai`);
  }
}
