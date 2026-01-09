/**
 * Vector math utilities for embeddings
 *
 * We L2-normalize at write time so cosine similarity = dot product.
 * This is a common optimization for vector search.
 */

/**
 * L2 normalize a vector (make it unit length)
 * @param {Float32Array} v
 * @returns {Float32Array} Normalized vector
 */
export function l2Normalize(v) {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i] / norm;
  }
  return out;
}

/**
 * Dot product of two vectors
 * For normalized vectors, this equals cosine similarity
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number}
 */
export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * b[i];
  }
  return s;
}

/**
 * Cosine similarity between two vectors
 * @param {Float32Array} a
 * @param {Float32Array} b
 * @returns {number} Similarity score between -1 and 1
 */
export function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Convert Float32Array to Buffer for SQLite storage
 * @param {Float32Array} v
 * @returns {Buffer}
 */
export function float32ToBuffer(v) {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

/**
 * Convert Buffer back to Float32Array
 * @param {Buffer} buf
 * @returns {Float32Array}
 */
export function bufferToFloat32(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}
