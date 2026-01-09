# Semantic Search for RUDI Sessions

## Architecture

### Core Principle: Offline-First, Cloud-Optional

**Local (Default):** SQLite remains canonical for sessions/turns/projects
**Cloud (Opt-in):** Postgres + pgvector for sync/team features only

Do NOT "switch to Postgres" for local — that breaks RUDI's zero-config model.

### Database Schema Extension

```sql
-- Add embeddings table (SQLite local store)
CREATE TABLE turn_embeddings (
  turn_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,           -- 'text-embedding-3-small', etc.
  dimensions INTEGER NOT NULL,   -- 1536, 3072, etc. (future-proof)
  embedding BLOB NOT NULL,       -- float32 array
  content_hash TEXT NOT NULL,    -- SHA256 of content (detect changes/dedupe)
  status TEXT NOT NULL DEFAULT 'done',  -- queued|done|error
  error TEXT,                    -- Error message if status=error
  created_at TEXT NOT NULL,
  FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE CASCADE
);

CREATE INDEX idx_turn_embeddings_model ON turn_embeddings(model, dimensions);
CREATE INDEX idx_turn_embeddings_status ON turn_embeddings(status);
CREATE INDEX idx_turn_embeddings_created ON turn_embeddings(created_at);
```

**Why BLOB + Brute Force for v1:**
- No native extensions needed (ships immediately in Electron)
- ~30K turns = ~100ms brute-force cosine (acceptable)
- Clear upgrade path to FAISS/pgvector later

### Vector Search Evolution Path

#### Phase 1: Brute Force (v1 - Ship Now)
```typescript
// In-memory cosine similarity (TypedArray)
// ~100ms for 30K vectors
// Zero dependencies, works everywhere

const cosineSimilarity = (a: Float32Array, b: Float32Array) => {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};
```

#### Phase 2: FAISS Index (Scale Upgrade)
```bash
# Separate index file alongside SQLite
~/.rudi/embeddings.faiss

# Fast approximate nearest neighbors
# <10ms for 100K+ vectors
# No server required
```

#### Phase 3: sqlite-vec (If Extension Path)
```bash
# Modern SQLite vector extension (replaces deprecated sqlite-vss)
# https://github.com/asg017/sqlite-vec
rudi install binary:sqlite-vec

# Query with HNSW index
SELECT * FROM vec_search(embeddings, query_vector, k => 10)
```

#### Phase 4: Postgres + pgvector (Cloud Only)
```sql
-- Only for RUDI Cloud (sync/team features)
CREATE INDEX ON turn_embeddings
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

**Decision Tree:**
- **< 50K turns:** Brute force (fast enough)
- **50K-500K turns:** FAISS index file
- **Cloud/team:** Postgres + pgvector
- **Never:** SQLite extensions in Electron (packaging pain)

## Embedding Generation

### Approach 1: On-Demand (Lazy)
```bash
# Generate embeddings when searching
rudi session search --semantic "How do I deploy to Vercel?"
# First time: generates embeddings (slow)
# Subsequent: uses cached embeddings (fast)
```

### Approach 2: Background (Proactive)
```bash
# Auto-generate embeddings for new turns
rudi session index --embeddings
# Runs in background
# Uses batch API for cost efficiency
```

### Approach 3: Agent-Triggered
```
When agent session ends:
  → Check if embeddings exist
  → Generate if missing
  → Store in turn_embeddings table
```

## Query Interface

### CLI
```bash
# Semantic search
rudi session search --semantic "authentication problems"
# Returns conceptually similar conversations

# Hybrid search (semantic + keyword)
rudi session search --hybrid "auth error" --semantic-weight 0.7

# Multi-modal search
rudi session search --code "async function" --semantic "authentication"
```

### MCP Server (For Agents)
```javascript
{
  name: "rudi_semantic_search",
  description: "Search user's conversation history semantically",
  input_schema: {
    query: "What did I learn about Vercel deployments?",
    limit: 10,
    include_context: true
  }
}
```

## Cost Analysis

### Embeddings Generation
- **Model**: text-embedding-3-small (OpenAI)
- **Cost**: $0.02 / 1M tokens
- **Average turn**: ~500 tokens
- **28,969 turns** = ~14.5M tokens = **$0.29 total**

### Storage
- **1536 dimensions** × 4 bytes (float32) = 6KB per turn
- **28,969 turns** = 174MB
- Compression possible → ~50MB

### Search Cost
- **Zero cost** - searches use cached embeddings
- No API calls after initial indexing

## RAG Pipeline

### Architecture
```
User Query
  ↓
Embed query → [0.123, -0.456, ...]
  ↓
Vector search → Top 10 relevant turns
  ↓
Rerank by date/project/relevance
  ↓
Format as context
  ↓
Send to LLM with query
  ↓
Answer with citations
```

### Example Flow
```bash
$ rudi ask "How did I fix the Vercel deployment issue?"

[RAG Pipeline]
1. Embed query
2. Search 28,969 turns
3. Find top 5 matches:
   - Session abc123, Turn 15 (95% similar)
   - Session def456, Turn 8  (92% similar)
   - ...
4. Format context:
   """
   From your session on Jan 7th with Claude:
   You: "The Vercel build is failing"
   Claude: "Let's check the vercel.json config..."
   """
5. Ask Claude with context
6. Return answer:
   "Based on your Jan 7th conversation, you fixed it by
    adding outputDirectory to vercel.json..."
```

## Advanced Features

### 1. Auto-Tagging
```javascript
// Cluster similar conversations
const clusters = await kMeans(embeddings, k=20)
clusters.forEach(cluster => {
  const label = await llm.generateLabel(cluster.turns)
  db.run('UPDATE sessions SET tags = ? WHERE id IN (?)',
         label, cluster.sessionIds)
})
```

### 2. Conversation Summarization
```javascript
// For sessions with 100+ turns
const longSession = getSession(id)
const chunks = chunkTurns(longSession.turns, size=10)
const summaries = await Promise.all(
  chunks.map(chunk => llm.summarize(chunk))
)
const finalSummary = await llm.summarize(summaries)

db.run('UPDATE sessions SET summary = ? WHERE id = ?',
       finalSummary, id)
```

### 3. Smart Context Selection
```javascript
// When resuming a session, include relevant past turns
const currentTopic = await llm.extractTopic(lastTurn)
const relevantHistory = await semanticSearch(currentTopic, limit=5)

// Inject into context
const context = [
  ...relevantHistory,
  ...recentTurns.slice(-10)
]
```

### 4. Cross-Session Learning
```javascript
// Find similar problems across all sessions
const problem = "deployment failing"
const similarIssues = await semanticSearch(problem, all_sessions=true)

// Show user: "You've encountered this 3 times before"
// Link to solutions
```

## Implementation Phases

### Phase 1: Basic Semantic Search
- [x] Add turn_embeddings table
- [ ] Generate embeddings for existing turns
- [ ] CLI: `rudi session search --semantic <query>`
- [ ] Test with 1000 turns first

### Phase 2: RAG Question Answering
- [ ] CLI: `rudi ask <question>`
- [ ] MCP: `rudi_ask` tool for agents
- [ ] Citation tracking
- [ ] Context window optimization

### Phase 3: Auto-Organization
- [ ] Auto-tagging via clustering
- [ ] Smart session summaries
- [ ] Duplicate detection
- [ ] Topic modeling

### Phase 4: Agent Integration
- [ ] Agents can search your history
- [ ] Agents learn from past solutions
- [ ] Cross-session memory
- [ ] Personalized responses

## Cost Estimate (Full Implementation)

### One-Time
- Initial embedding: $0.29
- New sessions: $0.0002 per session

### Storage
- 174MB embeddings
- Negligible cost

### Search
- Zero cost (local computation)

### RAG Queries
- $0.01 per query (if using Claude API)
- Free if using local models

## Example Usage

```bash
# Generate embeddings for all sessions
rudi session index --embeddings
# Progress: 28,969 / 28,969 turns [====================] 100%
# Cost: $0.29
# Time: ~2 minutes

# Semantic search
rudi session search --semantic "authentication bugs"
# Returns 10 most relevant conversations

# Ask questions about your history
rudi ask "How did I set up Docker for the resonance project?"
# [Searching 28,969 turns...]
# [Found 5 relevant conversations]
#
# Based on your conversation on Jan 5th:
# You set up Docker by creating a docker-compose.yml...
# [Citation: Session abc123, Turn 42]

# Find similar sessions
rudi session similar cc74dc30-2257-4a68-bd7e-332ac95fc8ea
# Sessions similar to "Moonlit Coalescing Book":
# 1. "Resonance Deployment" (87% similar)
# 2. "Vercel Setup Guide" (82% similar)
```

## Technical Details

### Embedding Models

| Model | Dimensions | Cost | Use Case |
|-------|-----------|------|----------|
| text-embedding-3-small | 1536 | $0.02/1M | Default |
| text-embedding-3-large | 3072 | $0.13/1M | High accuracy |
| Local (e.g., all-MiniLM) | 384 | Free | Privacy-first |

### Vector Search Performance

| Turns | Linear Scan | FAISS | sqlite-vss |
|-------|------------|-------|------------|
| 1K | 10ms | 1ms | 5ms |
| 10K | 100ms | 2ms | 15ms |
| 100K | 1000ms | 5ms | 50ms |
| 1M | 10s | 10ms | 200ms |

## Privacy Considerations

### Option 1: Cloud Embeddings (OpenAI)
- Pros: High quality, fast
- Cons: Data sent to OpenAI
- Mitigation: Only send turn text, no files

### Option 2: Local Embeddings
```bash
rudi install local-embeddings
rudi config set embeddings.provider local

# Uses sentence-transformers locally
# Zero external API calls
```

### Option 3: Hybrid
- Semantic search locally
- RAG answers via API (with user consent)

## Package Architecture

### @learnrudi/embeddings

```
packages/embeddings/
├── index.js
├── providers/
│   ├── openai.js         # text-embedding-3-small/large
│   ├── local.js          # sentence-transformers (ONNX)
│   └── cohere.js         # embed-english-v3.0
└── stores/
    ├── sqlite-blob.js    # Phase 1: BLOB + brute force
    ├── sqlite-vec.js     # Phase 2: Native ANN (optional)
    ├── faiss.js          # Phase 2: Index file (optional)
    └── pgvector.js       # Cloud: Postgres
```

### Interfaces

```typescript
// Embedding Provider
interface EmbeddingProvider {
  name: string
  dimensions: number
  embed(text: string): Promise<Float32Array>
  embedBatch(texts: string[]): Promise<Float32Array[]>
}

// Vector Store
interface VectorStore {
  name: string
  insert(turnId: string, embedding: Float32Array, metadata: object): Promise<void>
  search(query: Float32Array, limit: number, filters?: object): Promise<SearchResult[]>
  delete(turnId: string): Promise<void>
  stats(): Promise<{ count: number, dimensions: number }>
}
```

### Configuration

```bash
# Provider selection
rudi config set embeddings.provider openai    # Default
rudi config set embeddings.provider local     # Privacy-first
rudi config set embeddings.provider cohere    # Alternative

# Store selection
rudi config set embeddings.store sqlite-blob  # Default (brute force)
rudi config set embeddings.store faiss        # Index file (scale)

# Model selection
rudi config set embeddings.model text-embedding-3-small  # Default, 1536d
rudi config set embeddings.model text-embedding-3-large  # 3072d, higher accuracy
rudi config set embeddings.model all-MiniLM-L6-v2        # Local, 384d
```

## Decision Summary

| Question | Answer |
|----------|--------|
| Switch to Postgres? | **No** for local. SQLite remains canonical. |
| Use pgvector? | **Yes** but only for cloud/team features. |
| Which vector search? | **Brute force first** → FAISS → sqlite-vec |
| Ship native extension? | **No** for v1. BLOB + JS cosine is enough. |
| Cloud sync? | **Future** - Postgres + pgvector when ready. |

## Next Step

Implement `@learnrudi/embeddings` with:
1. OpenAI provider
2. sqlite-blob store
3. Brute-force cosine search

Wire into `rudi session search --semantic` + Studio EmbeddingsService.

**That gets you to a real feature without committing to any heavy infra.**
