/**
 * Hashing utilities for content deduplication
 */

import { createHash } from 'node:crypto';

/**
 * Generate SHA-256 hash of text content
 * @param {string} text
 * @returns {string} Hex-encoded hash
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
