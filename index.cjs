#!/usr/bin/env node
/**
 * PSTACK CLI v1.1.0 - Prompt Stack Command Line Interface
 *
 * Runtime commands work standalone (no app needed).
 * Stack commands require the Prompt Stack app to be running.
 *
 * RUNTIMES (29 total):
 *   Core:    node*, python, deno, bun               (* = bundled)
 *   Agents:  claude, codex, gemini, copilot, ollama (via npm)
 *   Tools:   git, ffmpeg, imagemagick, pandoc, chromium,
 *            jq, yq, sqlite, psql, httpie, tesseract, ytdlp, ripgrep*
 *   Cloud:   supabase, vercel, netlify, wrangler, railway, flyio (via npm)
 *   System:  docker (not managed)
 */

const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn, execSync } = require('child_process')

// Database module imports (lazy loaded)
let dbModule = null
let schemaModule = null
let importModule = null
let searchModule = null
let statsModule = null

function loadDbModules() {
  if (!dbModule) {
    dbModule = require('./db/index')
    schemaModule = require('./db/schema')
  }
}

function loadImportModule() {
  loadDbModules()
  if (!importModule) {
    importModule = require('./db/import')
  }
}

function loadSearchModule() {
  loadDbModules()
  if (!searchModule) {
    searchModule = require('./db/search')
  }
}

function loadStatsModule() {
  loadDbModules()
  if (!statsModule) {
    statsModule = require('./db/stats')
  }
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const VERSION = '2.0.0'
const PROMPT_STACK_HOME = path.join(os.homedir(), '.prompt-stack')
const RUNTIMES_DIR = path.join(PROMPT_STACK_HOME, 'runtimes')
const STACKS_DIR = path.join(PROMPT_STACK_HOME, 'stacks')
const PROMPTS_DIR = path.join(PROMPT_STACK_HOME, 'prompts')
const CONFIG_PATH = path.join(PROMPT_STACK_HOME, 'config.json')
const PORT_FILE = path.join(PROMPT_STACK_HOME, '.pstack-port')
const REQUEST_TIMEOUT = 300000 // 5 minutes

// Registry configuration (for stacks and prompts)
const REGISTRY_CONFIG = {
  repo: 'prompt-stack/registry',
  branch: 'main',
  baseUrl: 'https://raw.githubusercontent.com/prompt-stack/registry/main',
  apiUrl: 'https://api.github.com/repos/prompt-stack/registry',
  cachePath: path.join(PROMPT_STACK_HOME, 'registry-cache.json'),
  cacheMaxAge: 24 * 60 * 60 * 1000 // 24 hours
}

// Runtimes download configuration
const RUNTIMES_DOWNLOAD_BASE = 'https://github.com/prompt-stack/runtimes/releases/download/v1.0.0'

// Ensure directories exist
try { fs.mkdirSync(PROMPT_STACK_HOME, { recursive: true }) } catch {}
try { fs.mkdirSync(RUNTIMES_DIR, { recursive: true }) } catch {}
try { fs.mkdirSync(STACKS_DIR, { recursive: true }) } catch {}
try { fs.mkdirSync(PROMPTS_DIR, { recursive: true }) } catch {}

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

function getPlatformArch() {
  const p = os.platform()
  const a = os.arch()
  if (p === 'darwin' && a === 'arm64') return 'darwin-arm64'
  if (p === 'darwin' && a === 'x64') return 'darwin-x64'
  if (p === 'linux' && a === 'x64') return 'linux-x64'
  if (p === 'linux' && a === 'arm64') return 'linux-arm64'
  return `${p}-${a}`
}

// ============================================================================
// BUNDLED RUNTIMES DETECTION
// ============================================================================

function findBundledRuntimes() {
  const locations = [
    process.env.RESOURCES_PATH ? path.join(process.env.RESOURCES_PATH, 'bundled-runtimes') : null,
    path.join(__dirname, '..', 'bundled-runtimes'),
    '/Applications/Prompt Stack.app/Contents/Resources/bundled-runtimes',
    path.join(os.homedir(), 'Applications/Prompt Stack.app/Contents/Resources/bundled-runtimes')
  ].filter(Boolean)

  for (const loc of locations) {
    if (fs.existsSync(loc)) return loc
  }
  return null
}

const BUNDLED_RUNTIMES = findBundledRuntimes()

// ============================================================================
// RUNTIME REGISTRY
// ============================================================================

const REGISTRY = {
  version: '1.1.0',
  runtimes: {
    // CORE (bundled)
    node: {
      name: 'Node.js', version: '20.10.0', category: 'core',
      description: 'JavaScript runtime for agents and stacks',
      bundled: true, binary: 'node/bin/node',
      download: { 'darwin-arm64': 'node-20.10.0-darwin-arm64.tar.gz', 'darwin-x64': 'node-20.10.0-darwin-x64.tar.gz' }
    },
    ripgrep: {
      name: 'ripgrep', version: '14.0', category: 'tool',
      description: 'Fast text search',
      bundled: true, binary: { 'darwin-arm64': 'ripgrep/arm64/rg', 'darwin-x64': 'ripgrep/x64/rg' },
      download: { 'darwin-arm64': 'ripgrep-14.0-darwin-arm64.tar.gz', 'darwin-x64': 'ripgrep-14.0-darwin-x64.tar.gz' }
    },
    // CORE (on-demand)
    python: {
      name: 'Python', version: '3.12', category: 'core',
      description: 'Python runtime with data/ML packages',
      bundled: false, binary: 'python/bin/python3',
      download: { 'darwin-arm64': 'python-3.12-darwin-arm64.tar.gz', 'darwin-x64': 'python-3.12-darwin-x64.tar.gz' }
    },
    deno: {
      name: 'Deno', version: '1.40', category: 'core',
      description: 'Secure JavaScript/TypeScript runtime',
      bundled: false, binary: 'deno/deno',
      download: { 'darwin-arm64': 'deno-1.40-darwin-arm64.tar.gz', 'darwin-x64': 'deno-1.40-darwin-x64.tar.gz' }
    },
    bun: {
      name: 'Bun', version: '1.0', category: 'core',
      description: 'Fast JavaScript runtime',
      bundled: false, binary: 'bun/bun',
      download: { 'darwin-arm64': 'bun-1.0-darwin-arm64.tar.gz', 'darwin-x64': 'bun-1.0-darwin-x64.tar.gz' }
    },
    // AGENTS (on-demand install from npm - compliant with distribution policies)
    claude: {
      name: 'Claude Code', version: 'latest', category: 'agent',
      description: 'Anthropic Claude Code CLI',
      bundled: false, installType: 'npm', npmPackage: '@anthropic-ai/claude-code',
      binary: 'agents/claude/node_modules/.bin/claude', installDir: 'agents/claude',
      requiresAuth: true, authInstructions: "Click 'Connect Claude' in the app, or run 'claude' in terminal and type '/login' (requires Claude Pro or Max subscription)"
    },
    codex: {
      name: 'OpenAI Codex', version: 'latest', category: 'agent',
      description: 'OpenAI Codex CLI',
      bundled: false, installType: 'npm', npmPackage: '@openai/codex',
      binary: 'agents/codex/node_modules/.bin/codex', installDir: 'agents/codex',
      requiresAuth: true, authInstructions: "Run 'codex login' to authenticate with OpenAI"
    },
    gemini: {
      name: 'Gemini CLI', version: 'latest', category: 'agent',
      description: 'Google Gemini CLI',
      bundled: false, installType: 'npm', npmPackage: '@google/gemini-cli',
      binary: 'agents/gemini/node_modules/.bin/gemini', installDir: 'agents/gemini',
      requiresAuth: true, authInstructions: "Run 'gemini' - authentication will be prompted on first use"
    },
    copilot: {
      name: 'GitHub Copilot', version: 'latest', category: 'agent',
      description: 'GitHub Copilot CLI',
      bundled: false, installType: 'npm', npmPackage: '@githubnext/github-copilot-cli',
      binary: 'agents/copilot/node_modules/.bin/github-copilot-cli', installDir: 'agents/copilot',
      requiresAuth: true, authInstructions: "Run 'github-copilot-cli auth' to authenticate"
    },
    ollama: {
      name: 'Ollama', version: '0.5', category: 'agent',
      description: 'Run local LLMs (Llama, Mistral, etc.)',
      bundled: false, binary: 'ollama/ollama',
      download: { 'darwin-arm64': 'ollama-0.5-darwin-arm64.tar.gz', 'darwin-x64': 'ollama-0.5-darwin-x64.tar.gz' }
    },
    // TOOLS
    git: {
      name: 'Git', version: '2.43', category: 'tool',
      description: 'Version control',
      bundled: false, binary: 'git/bin/git',
      download: { 'darwin-arm64': 'git-2.43-darwin-arm64.tar.gz', 'darwin-x64': 'git-2.43-darwin-x64.tar.gz' },
      fallbackCheck: 'git --version'
    },
    ffmpeg: {
      name: 'FFmpeg', version: '6.0', category: 'tool',
      description: 'Audio/video processing',
      bundled: false, binary: 'ffmpeg/ffmpeg',
      download: { 'darwin-arm64': 'ffmpeg-6.0-darwin-arm64.tar.gz', 'darwin-x64': 'ffmpeg-6.0-darwin-x64.tar.gz' }
    },
    imagemagick: {
      name: 'ImageMagick', version: '7.1', category: 'tool',
      description: 'Image processing',
      bundled: false, binary: 'imagemagick/magick',
      download: { 'darwin-arm64': 'imagemagick-7.1-darwin-arm64.tar.gz', 'darwin-x64': 'imagemagick-7.1-darwin-x64.tar.gz' }
    },
    pandoc: {
      name: 'Pandoc', version: '3.5', category: 'tool',
      description: 'Document conversion',
      bundled: false, binary: 'pandoc/pandoc',
      download: { 'darwin-arm64': 'pandoc-3.5-darwin-arm64.tar.gz', 'darwin-x64': 'pandoc-3.5-darwin-x64.tar.gz' }
    },
    chromium: {
      name: 'Chromium', version: '131', category: 'tool',
      description: 'Browser automation',
      bundled: false, format: 'zip',
      binary: {
        'darwin-arm64': 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'darwin-x64': 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
      },
      download: { 'darwin-arm64': 'chromium-131-darwin-arm64.zip', 'darwin-x64': 'chromium-131-darwin-x64.zip' }
    },
    jq: {
      name: 'jq', version: '1.7', category: 'tool',
      description: 'JSON processor',
      bundled: false, binary: 'jq/jq',
      download: { 'darwin-arm64': 'jq-1.7-darwin-arm64.tar.gz', 'darwin-x64': 'jq-1.7-darwin-x64.tar.gz' }
    },
    yq: {
      name: 'yq', version: '4.40', category: 'tool',
      description: 'YAML processor',
      bundled: false, binary: 'yq/yq',
      download: { 'darwin-arm64': 'yq-4.40-darwin-arm64.tar.gz', 'darwin-x64': 'yq-4.40-darwin-x64.tar.gz' }
    },
    sqlite: {
      name: 'SQLite', version: '3.44', category: 'tool',
      description: 'Local database',
      bundled: false, binary: 'sqlite/sqlite3',
      download: { 'darwin-arm64': 'sqlite-3.44-darwin-arm64.tar.gz', 'darwin-x64': 'sqlite-3.44-darwin-x64.tar.gz' }
    },
    psql: {
      name: 'PostgreSQL Client', version: '16', category: 'tool',
      description: 'PostgreSQL client for database connections',
      managed: false, checkCommand: 'psql --version',
      instructions: 'Install via Homebrew: brew install libpq && brew link libpq --force'
    },
    httpie: {
      name: 'HTTPie', version: '3.2', category: 'tool',
      description: 'Modern HTTP client for API testing',
      managed: false, checkCommand: 'http --version',
      instructions: 'Install via Homebrew: brew install httpie'
    },
    tesseract: {
      name: 'Tesseract OCR', version: '5.3', category: 'tool',
      description: 'OCR text extraction from images',
      managed: false, checkCommand: 'tesseract --version',
      instructions: 'Install via Homebrew: brew install tesseract'
    },
    ytdlp: {
      name: 'yt-dlp', version: '2024.01', category: 'tool',
      description: 'Video downloader',
      bundled: false, binary: 'ytdlp/yt-dlp',
      download: { 'darwin-arm64': 'ytdlp-2024.01-darwin-arm64.tar.gz', 'darwin-x64': 'ytdlp-2024.01-darwin-x64.tar.gz' }
    },
    // CLOUD CLIs (via npm)
    supabase: {
      name: 'Supabase CLI', version: 'latest', category: 'cloud',
      description: 'Supabase development',
      bundled: false, installType: 'npm', npmPackage: 'supabase',
      binary: 'tools/supabase/node_modules/.bin/supabase', installDir: 'tools/supabase'
    },
    vercel: {
      name: 'Vercel CLI', version: 'latest', category: 'cloud',
      description: 'Deploy to Vercel',
      bundled: false, installType: 'npm', npmPackage: 'vercel',
      binary: 'tools/vercel/node_modules/.bin/vercel', installDir: 'tools/vercel',
      requiresAuth: true, authInstructions: "Run 'vercel login' to authenticate"
    },
    netlify: {
      name: 'Netlify CLI', version: 'latest', category: 'cloud',
      description: 'Deploy to Netlify',
      bundled: false, installType: 'npm', npmPackage: 'netlify-cli',
      binary: 'tools/netlify/node_modules/.bin/netlify', installDir: 'tools/netlify',
      requiresAuth: true, authInstructions: "Run 'netlify login' to authenticate"
    },
    wrangler: {
      name: 'Cloudflare Wrangler', version: 'latest', category: 'cloud',
      description: 'Deploy to Cloudflare',
      bundled: false, installType: 'npm', npmPackage: 'wrangler',
      binary: 'tools/wrangler/node_modules/.bin/wrangler', installDir: 'tools/wrangler',
      requiresAuth: true, authInstructions: "Run 'wrangler login' to authenticate"
    },
    railway: {
      name: 'Railway CLI', version: 'latest', category: 'cloud',
      description: 'Deploy to Railway',
      bundled: false, installType: 'npm', npmPackage: '@railway/cli',
      binary: 'tools/railway/node_modules/.bin/railway', installDir: 'tools/railway',
      requiresAuth: true, authInstructions: "Run 'railway login' to authenticate"
    },
    flyio: {
      name: 'Fly.io CLI', version: 'latest', category: 'cloud',
      description: 'Deploy to Fly.io',
      bundled: false, installType: 'npm', npmPackage: 'flyctl',
      binary: 'tools/flyio/node_modules/.bin/flyctl', installDir: 'tools/flyio',
      requiresAuth: true, authInstructions: "Run 'fly auth login' to authenticate"
    },
    // SYSTEM
    docker: {
      name: 'Docker', category: 'system',
      description: 'Container runtime',
      managed: false, checkCommand: 'docker --version',
      instructions: 'Install Docker Desktop from https://docker.com/download'
    }
  }
}

// ============================================================================
// RUNTIME HELPERS
// ============================================================================

function getBinaryPath(runtime) {
  if (!runtime.binary) return null
  if (typeof runtime.binary === 'string') return runtime.binary
  return runtime.binary[getPlatformArch()] || null
}

function getRuntimePath(runtimeId) {
  const runtime = REGISTRY.runtimes[runtimeId]
  if (!runtime) return null

  if (runtime.managed === false) {
    try {
      const result = execSync(`which ${runtimeId}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] })
      return result.trim() || null
    } catch { return null }
  }

  const binaryPath = getBinaryPath(runtime)
  if (!binaryPath) return null

  // Check user-installed first
  const userPath = path.join(RUNTIMES_DIR, binaryPath)
  if (fs.existsSync(userPath)) return userPath

  // Check bundled
  if (BUNDLED_RUNTIMES && runtime.bundled) {
    const bundledPath = path.join(BUNDLED_RUNTIMES, binaryPath)
    if (fs.existsSync(bundledPath)) return bundledPath
  }

  return null
}

function isRuntimeInstalled(runtimeId) {
  const runtime = REGISTRY.runtimes[runtimeId]
  if (!runtime) return false

  if (runtime.managed === false) {
    try { execSync(runtime.checkCommand, { stdio: 'ignore' }); return true }
    catch { return false }
  }

  return getRuntimePath(runtimeId) !== null
}

// ============================================================================
// DOWNLOAD / INSTALL
// ============================================================================

async function downloadRuntime(runtimeId) {
  const runtime = REGISTRY.runtimes[runtimeId]
  if (!runtime) {
    console.error(`Unknown runtime: ${runtimeId}`)
    console.error('Run "pstack runtime list" to see available runtimes.')
    process.exit(1)
  }

  if (runtime.managed === false) {
    console.log(runtime.instructions)
    process.exit(1)
  }

  // npm-based install
  if (runtime.installType === 'npm') {
    await installNpmPackage(runtimeId, runtime)
    return
  }

  const platformArch = getPlatformArch()
  const downloadFile = runtime.download?.[platformArch]
  if (!downloadFile) {
    console.error(`No download available for ${runtimeId} on ${platformArch}`)
    process.exit(1)
  }

  const url = `${RUNTIMES_DOWNLOAD_BASE}/${downloadFile}`
  const isZip = runtime.format === 'zip' || downloadFile.endsWith('.zip')

  console.log(`\nDownloading ${runtime.name} ${runtime.version || ''}...`)
  console.log(`  From: ${url}`)

  const tempFile = path.join(RUNTIMES_DIR, `download-${Date.now()}${isZip ? '.zip' : '.tar.gz'}`)

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const buffer = Buffer.from(await response.arrayBuffer())
    fs.writeFileSync(tempFile, buffer)

    console.log('  Extracting...')
    if (isZip) {
      execSync(`unzip -q -o "${tempFile}" -d "${RUNTIMES_DIR}"`, { stdio: 'ignore' })
    } else {
      execSync(`tar -xzf "${tempFile}" -C "${RUNTIMES_DIR}"`, { stdio: 'ignore' })
    }
    fs.unlinkSync(tempFile)

    console.log(`\n✓ ${runtime.name} installed to ${RUNTIMES_DIR}`)

  } catch (error) {
    try { fs.unlinkSync(tempFile) } catch {}
    console.error(`\nDownload failed: ${error.message}`)
    process.exit(1)
  }
}

async function installNpmPackage(runtimeId, runtime) {
  const installDir = path.join(RUNTIMES_DIR, runtime.installDir || `agents/${runtimeId}`)

  console.log(`\nInstalling ${runtime.name}...`)
  console.log(`  Package: ${runtime.npmPackage}`)
  console.log('  (Downloads from official npm registry)\n')

  try { fs.mkdirSync(installDir, { recursive: true }) } catch {}

  // Find npm and node
  let npmPath = 'npm'
  let nodeBinDir = null
  if (BUNDLED_RUNTIMES) {
    const bundledNpm = path.join(BUNDLED_RUNTIMES, 'node/bin/npm')
    if (fs.existsSync(bundledNpm)) {
      npmPath = bundledNpm
      nodeBinDir = path.join(BUNDLED_RUNTIMES, 'node/bin')
    }
  }
  const userNpm = path.join(RUNTIMES_DIR, 'node/bin/npm')
  if (fs.existsSync(userNpm)) {
    npmPath = userNpm
    nodeBinDir = path.join(RUNTIMES_DIR, 'node/bin')
  }

  // Create package.json
  const pkgPath = path.join(installDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    fs.writeFileSync(pkgPath, JSON.stringify({ name: `pstack-${runtimeId}`, version: '1.0.0', private: true }, null, 2))
  }

  try {
    // Add node's bin directory to PATH so npm's shebang can find node
    const env = { ...process.env, npm_config_fund: 'false', npm_config_audit: 'false' }
    if (nodeBinDir) {
      env.PATH = `${nodeBinDir}:${env.PATH || ''}`
    }

    // Use --ignore-scripts to avoid node-gyp issues with bundled npm
    // Most agent CLIs are pre-bundled and don't need postinstall scripts
    execSync(`"${npmPath}" install --ignore-scripts ${runtime.npmPackage}`, {
      cwd: installDir, stdio: 'inherit',
      env
    })

    console.log(`\n✓ ${runtime.name} installed!`)
    if (runtime.requiresAuth) {
      console.log(`\n  Authentication required: ${runtime.authInstructions}`)
    }
  } catch (error) {
    console.error(`\nInstallation failed: ${error.message}`)
    process.exit(1)
  }
}

// ============================================================================
// HTTP CLIENT (for app communication)
// ============================================================================

function getAppPort() {
  try {
    const port = fs.readFileSync(PORT_FILE, 'utf-8').trim()
    return parseInt(port, 10) || null
  } catch { return null }
}

function makeAppRequest(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const port = getAppPort()
    if (!port) {
      reject(new Error('Prompt Stack app is not running'))
      return
    }

    const options = {
      hostname: '127.0.0.1', port, path: endpoint, method,
      timeout: REQUEST_TIMEOUT,
      headers: { 'Content-Type': 'application/json' }
    }

    const req = http.request(options, (res) => {
      let data = ''
      let lineBuffer = ''

      res.on('data', (chunk) => {
        const text = chunk.toString()
        if (res.headers['content-type']?.includes('application/json')) {
          data += text
        } else {
          lineBuffer += text
          const lines = lineBuffer.split('\n')
          lineBuffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('{"exitCode":')) {
              try {
                const r = JSON.parse(line)
                if (typeof r.exitCode === 'number' && r.exitCode !== 0) process.exitCode = r.exitCode
              } catch { process.stdout.write(line + '\n') }
            } else {
              process.stdout.write(line + '\n')
            }
          }
        }
      })

      res.on('end', () => {
        if (lineBuffer) process.stdout.write(lineBuffer)
        if (data) {
          try { resolve(JSON.parse(data)) }
          catch { resolve(data) }
        } else resolve()
      })
      res.on('error', reject)
    })

    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
    req.on('error', (err) => reject(err.code === 'ECONNREFUSED' ? new Error('Cannot connect to app') : err))

    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

// ============================================================================
// REGISTRY FUNCTIONS
// ============================================================================

/**
 * Load user config from ~/.prompt-stack/config.json
 */
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {}
  return {}
}

/**
 * Fetch and cache the registry index from GitHub
 */
async function fetchRegistryIndex(forceRefresh = false) {
  // Check cache first
  if (!forceRefresh && fs.existsSync(REGISTRY_CONFIG.cachePath)) {
    try {
      const cacheData = JSON.parse(fs.readFileSync(REGISTRY_CONFIG.cachePath, 'utf-8'))
      const cacheAge = Date.now() - cacheData.cachedAt

      if (cacheAge < REGISTRY_CONFIG.cacheMaxAge) {
        return cacheData.registry
      }
    } catch {}
  }

  // Fetch from GitHub
  const url = `${REGISTRY_CONFIG.baseUrl}/registry.json`

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const raw = await response.json()

    // Normalize: registry has { official: [], community: [] } structure
    // Flatten into single arrays
    const flattenCategory = (obj) => {
      if (Array.isArray(obj)) return obj
      if (obj && typeof obj === 'object') {
        return [...(obj.official || []), ...(obj.community || [])]
      }
      return []
    }

    const registry = {
      version: raw.version,
      stacks: flattenCategory(raw.tools),
      prompts: flattenCategory(raw.prompts)
    }

    // Save to cache
    const cacheData = { cachedAt: Date.now(), registry }
    fs.writeFileSync(REGISTRY_CONFIG.cachePath, JSON.stringify(cacheData, null, 2))

    return registry

  } catch (error) {
    // Fallback to stale cache
    if (fs.existsSync(REGISTRY_CONFIG.cachePath)) {
      try {
        const cacheData = JSON.parse(fs.readFileSync(REGISTRY_CONFIG.cachePath, 'utf-8'))
        console.warn('Using cached registry (offline mode)')
        // Ensure stacks/prompts are arrays (handle old cache format)
        const reg = cacheData.registry
        if (reg.stacks && !Array.isArray(reg.stacks)) {
          reg.stacks = [...(reg.stacks.official || []), ...(reg.stacks.community || [])]
        }
        if (reg.prompts && !Array.isArray(reg.prompts)) {
          reg.prompts = [...(reg.prompts.official || []), ...(reg.prompts.community || [])]
        }
        return reg
      } catch {}
    }
    throw new Error(`Cannot fetch registry: ${error.message}`)
  }
}

/**
 * Detect type: 'runtime' | 'stack' | 'prompt' | null
 * Priority: runtime > stack > prompt
 */
async function detectType(name) {
  // 1. Runtime (hardcoded, finite list)
  if (REGISTRY.runtimes[name]) return 'runtime'

  // 2. Check registry
  try {
    const registry = await fetchRegistryIndex()
    if (registry.stacks.find(s => s.id === name)) return 'stack'
    if (registry.prompts.find(p => p.id === name)) return 'prompt'
  } catch {}

  // 3. Check local installations
  if (fs.existsSync(path.join(STACKS_DIR, name))) return 'stack'
  if (fs.existsSync(path.join(PROMPTS_DIR, `${name}.md`))) return 'prompt'

  return null
}

/**
 * Search registry for stacks, prompts, and runtimes
 */
async function searchRegistry(query, options = {}) {
  const { type = 'all', limit = 50 } = options
  const results = []
  const queryLower = query.toLowerCase()

  // Search runtimes
  if (type === 'all' || type === 'runtime') {
    for (const [id, runtime] of Object.entries(REGISTRY.runtimes)) {
      if (id.includes(queryLower) ||
          runtime.name.toLowerCase().includes(queryLower) ||
          runtime.description.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'runtime',
          id,
          name: runtime.name,
          description: runtime.description,
          category: runtime.category,
          installed: isRuntimeInstalled(id)
        })
      }
    }
  }

  // Search stacks and prompts from registry
  try {
    const registry = await fetchRegistryIndex()

    if (type === 'all' || type === 'stack') {
      for (const stack of registry.stacks) {
        if (stack.id.includes(queryLower) ||
            stack.name.toLowerCase().includes(queryLower) ||
            stack.description.toLowerCase().includes(queryLower)) {
          results.push({
            type: 'stack',
            id: stack.id,
            name: stack.name,
            description: stack.description,
            category: stack.category,
            installed: fs.existsSync(path.join(STACKS_DIR, stack.id))
          })
        }
      }
    }

    if (type === 'all' || type === 'prompt') {
      for (const prompt of registry.prompts) {
        if (prompt.id.includes(queryLower) ||
            prompt.name.toLowerCase().includes(queryLower) ||
            prompt.description.toLowerCase().includes(queryLower)) {
          results.push({
            type: 'prompt',
            id: prompt.id,
            name: prompt.name,
            description: prompt.description,
            category: prompt.category,
            installed: fs.existsSync(path.join(PROMPTS_DIR, `${prompt.id}.md`))
          })
        }
      }
    }
  } catch (err) {
    console.warn(`Registry search limited: ${err.message}`)
  }

  // Sort: exact match > name match > description match
  results.sort((a, b) => {
    const aExact = a.id === queryLower ? 3 : 0
    const bExact = b.id === queryLower ? 3 : 0
    const aName = a.name.toLowerCase().includes(queryLower) ? 2 : 0
    const bName = b.name.toLowerCase().includes(queryLower) ? 2 : 0
    return (bExact + bName) - (aExact + aName)
  })

  return results.slice(0, limit)
}

/**
 * Install a prompt from the registry
 */
async function installPrompt(promptId, force = false) {
  const registry = await fetchRegistryIndex()
  const prompt = registry.prompts.find(p => p.id === promptId)

  if (!prompt) throw new Error(`Prompt not found: ${promptId}`)

  const targetPath = path.join(PROMPTS_DIR, `${promptId}.md`)

  if (fs.existsSync(targetPath) && !force) {
    console.log(`Prompt '${promptId}' is already installed.`)
    console.log(`Use --force to reinstall.`)
    return
  }

  const url = `${REGISTRY_CONFIG.baseUrl}/${prompt.path}`
  console.log(`\nDownloading: ${prompt.name}`)
  console.log(`  From: ${url}`)

  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)

  const content = await response.text()
  fs.writeFileSync(targetPath, content)

  console.log(`\n✓ Prompt installed: ${targetPath}`)
}

/**
 * Install a stack from the registry
 */
async function installStack(stackId, force = false, skipDeps = false) {
  const registry = await fetchRegistryIndex()
  const stack = registry.stacks.find(s => s.id === stackId)

  if (!stack) throw new Error(`Stack not found: ${stackId}`)

  const targetDir = path.join(STACKS_DIR, stackId)
  const tempDir = path.join(STACKS_DIR, `.${stackId}.tmp`)

  if (fs.existsSync(targetDir) && !force) {
    console.log(`Stack '${stackId}' is already installed.`)
    console.log(`Use --force to reinstall.`)
    return
  }

  console.log(`\nInstalling: ${stack.name}`)
  if (stack.category) console.log(`  Category: ${stack.category}`)
  if (stack.runtime) console.log(`  Runtime: ${stack.runtime}`)

  try {
    // Get directory listing from GitHub API
    const apiUrl = `${REGISTRY_CONFIG.apiUrl}/contents/${stack.path}?ref=${REGISTRY_CONFIG.branch}`
    const response = await fetch(apiUrl)
    if (!response.ok) throw new Error(`GitHub API error: ${response.status}`)

    const files = await response.json()

    // Create temp directory
    fs.mkdirSync(tempDir, { recursive: true })

    // Download each file
    console.log('\n  Downloading files:')
    for (const file of files) {
      if (file.type === 'file') {
        console.log(`    - ${file.name}`)
        const fileResponse = await fetch(file.download_url)
        const fileContent = await fileResponse.text()
        const filePath = path.join(tempDir, file.name)
        fs.writeFileSync(filePath, fileContent)

        // Make scripts executable
        if (file.name.endsWith('.sh') || file.name.endsWith('.py') || file.name.endsWith('.js')) {
          fs.chmodSync(filePath, 0o755)
        }
      }
    }

    // Remove old version if exists, rename temp to final
    if (fs.existsSync(targetDir)) {
      fs.rmSync(targetDir, { recursive: true, force: true })
    }
    fs.renameSync(tempDir, targetDir)

    console.log(`\n✓ Stack installed: ${targetDir}`)

    // Install dependencies
    if (!skipDeps) {
      console.log('\nChecking dependencies...')
      await ensureStackDependencies(stackId)
    }

    // Show secrets warning
    if (stack.requiresSecrets && stack.requiresSecrets.length > 0) {
      console.log('\n⚠️  This stack requires secrets:')
      for (const secret of stack.requiresSecrets) {
        console.log(`    - ${secret}`)
      }
      console.log('\n  Configure in Prompt Stack app settings.')
    }

    console.log(`\n  Run with: pstack run ${stackId}`)

  } catch (error) {
    // Cleanup on failure
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
    throw new Error(`Failed to install stack: ${error.message}`)
  }
}

// ============================================================================
// COMMAND HANDLERS (v2.0)
// ============================================================================

function showHelp() {
  console.log(`
pstack v${VERSION} - Prompt Stack CLI

USAGE:
  pstack                        Show status dashboard
  pstack <command> [options]

COMMANDS:
  search <query>              Search registry for stacks, prompts, runtimes
  install <name>              Install a stack, prompt, or runtime
  run <name> [args...]        Run a stack or prompt
  list                        Show all installed items
  remove <name>               Uninstall a stack, prompt, or runtime
  which <runtime>             Print path to runtime binary
  update [name]               Update installed items

DATABASE (power users):
  db init                     Initialize database
  db import [--force]         Import from ~/.claude, ~/.gemini, ~/.codex
  db search <query>           Search conversations
  db stats                    Show usage statistics

OPTIONS:
  -h, --help                  Show this help
  -v, --version               Show version

RUNTIMES (29 available):
  Agents:  claude, codex, gemini, copilot, ollama
  Core:    node*, python, deno, bun           (* = bundled)
  Tools:   git, ffmpeg, pandoc, chromium, jq, sqlite, ripgrep*...
  Cloud:   vercel, netlify, supabase, wrangler, railway, flyio

EXAMPLES:
  pstack                      # Status dashboard
  pstack search video         # Find stacks/prompts
  pstack install claude       # Install Claude agent
  pstack install summarizer   # Install a stack
  pstack run summarizer       # Run it
  pstack list                 # See what's installed
  pstack which python         # Get runtime path
`)
}

/**
 * Show status dashboard (default when no command given)
 */
async function showDashboard() {
  console.log(`\n\x1b[1mpstack v${VERSION}\x1b[0m\n`)

  // App status
  const port = getAppPort()
  const appStatus = port ? '\x1b[32m● Running\x1b[0m' : '\x1b[31m○ Not running\x1b[0m'
  console.log(`App:       ${appStatus}`)

  // Agents status (single line)
  const agents = ['claude', 'codex', 'gemini', 'copilot', 'ollama']
  const agentStatus = agents.map(a => {
    const installed = isRuntimeInstalled(a)
    return installed ? `\x1b[32m${a}\x1b[0m` : `\x1b[90m${a}\x1b[0m`
  }).join('  ')
  console.log(`Agents:    ${agentStatus}`)

  // Runtimes count
  let installedRuntimes = 0
  for (const [id, runtime] of Object.entries(REGISTRY.runtimes)) {
    if (runtime.category !== 'agent' && isRuntimeInstalled(id)) installedRuntimes++
  }
  console.log(`Runtimes:  ${installedRuntimes} installed`)

  // Stacks count
  let stackCount = 0
  try {
    const stacks = fs.readdirSync(STACKS_DIR).filter(f => !f.startsWith('.'))
    stackCount = stacks.length
  } catch {}
  console.log(`Stacks:    ${stackCount} installed`)

  // Prompts count
  let promptCount = 0
  try {
    const prompts = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'))
    promptCount = prompts.length
  } catch {}
  console.log(`Prompts:   ${promptCount} installed`)

  // Quick tips
  console.log(`
\x1b[90m─────────────────────────────────────\x1b[0m
  pstack search <query>    Find stacks/prompts
  pstack install <name>    Install something
  pstack list              See installed items
  pstack --help            Full command list
`)
}

/**
 * Unified list command - shows everything installed
 */
async function showList() {
  console.log('\n\x1b[1mInstalled Items\x1b[0m\n')

  // Agents (single line with checkmarks)
  const agents = ['claude', 'codex', 'gemini', 'copilot', 'ollama']
  const agentLine = agents.map(a => {
    const installed = isRuntimeInstalled(a)
    return installed ? `\x1b[32m✓\x1b[0m ${a}` : `\x1b[31m✗\x1b[0m \x1b[90m${a}\x1b[0m`
  }).join('  ')
  console.log(`Agents     ${agentLine}`)

  // Runtimes (grouped, single line summary)
  const runtimeCategories = { core: [], tool: [], cloud: [] }
  for (const [id, runtime] of Object.entries(REGISTRY.runtimes)) {
    if (runtime.category === 'agent') continue
    if (isRuntimeInstalled(id)) {
      const cat = runtime.category === 'core' ? 'core' :
                  runtime.category === 'cloud' ? 'cloud' : 'tool'
      runtimeCategories[cat].push(id)
    }
  }
  const runtimeSummary = [
    ...runtimeCategories.core,
    ...runtimeCategories.tool.slice(0, 3),
    runtimeCategories.tool.length > 3 ? `+${runtimeCategories.tool.length - 3} more` : null,
    ...runtimeCategories.cloud
  ].filter(Boolean).join(', ')
  console.log(`Runtimes   ${runtimeSummary || '\x1b[90mnone installed\x1b[0m'}`)

  // Stacks
  console.log('\n\x1b[1mStacks\x1b[0m')
  try {
    const stacks = fs.readdirSync(STACKS_DIR).filter(f => !f.startsWith('.'))
    if (stacks.length === 0) {
      console.log('  \x1b[90m(none installed)\x1b[0m')
    } else {
      for (const stack of stacks) {
        const manifest = parseStackManifest(path.join(STACKS_DIR, stack))
        const desc = manifest?.name || stack
        console.log(`  ${stack.padEnd(24)} ${desc}`)
      }
    }
  } catch {
    console.log('  \x1b[90m(none installed)\x1b[0m')
  }

  // Prompts
  console.log('\n\x1b[1mPrompts\x1b[0m')
  try {
    const prompts = fs.readdirSync(PROMPTS_DIR).filter(f => f.endsWith('.md'))
    if (prompts.length === 0) {
      console.log('  \x1b[90m(none installed)\x1b[0m')
    } else {
      for (const prompt of prompts) {
        const id = prompt.replace('.md', '')
        console.log(`  ${id}`)
      }
    }
  } catch {
    console.log('  \x1b[90m(none installed)\x1b[0m')
  }

  console.log('')
}

/**
 * Unified install command
 */
async function installItem(name, options = {}) {
  const { force = false, skipDeps = false } = options

  const type = await detectType(name)

  if (!type) {
    console.error(`\x1b[31mNot found:\x1b[0m ${name}`)
    console.error(`\nTry: pstack search ${name}`)
    process.exit(1)
  }

  switch (type) {
    case 'runtime':
      if (isRuntimeInstalled(name)) {
        const p = getRuntimePath(name)
        console.log(`${REGISTRY.runtimes[name].name} is already installed.`)
        if (p) console.log(`  Path: ${p}`)
        if (force) {
          console.log('\nReinstalling...')
          await downloadRuntime(name)
        }
        return
      }
      await downloadRuntime(name)
      break

    case 'stack':
      await installStack(name, force, skipDeps)
      break

    case 'prompt':
      await installPrompt(name, force)
      break
  }
}

/**
 * Unified remove command
 */
async function removeItem(name) {
  // Check runtime
  const runtime = REGISTRY.runtimes[name]
  if (runtime) {
    if (runtime.bundled) {
      console.error(`${runtime.name} is bundled and cannot be removed.`)
      process.exit(1)
    }
    if (runtime.managed === false) {
      console.error(`${runtime.name} is system-managed. Uninstall manually.`)
      process.exit(1)
    }

    const binaryPath = getBinaryPath(runtime)
    if (!binaryPath) {
      console.error(`Cannot determine path for ${name}`)
      process.exit(1)
    }

    const dir = path.join(RUNTIMES_DIR, binaryPath.split('/')[0])
    if (!fs.existsSync(dir)) {
      console.log(`${runtime.name} is not installed.`)
      return
    }

    fs.rmSync(dir, { recursive: true, force: true })
    console.log(`✓ ${runtime.name} removed.`)
    return
  }

  // Check stack
  const stackPath = path.join(STACKS_DIR, name)
  if (fs.existsSync(stackPath)) {
    fs.rmSync(stackPath, { recursive: true, force: true })
    console.log(`✓ Stack '${name}' removed.`)
    return
  }

  // Check prompt
  const promptPath = path.join(PROMPTS_DIR, `${name}.md`)
  if (fs.existsSync(promptPath)) {
    fs.unlinkSync(promptPath)
    console.log(`✓ Prompt '${name}' removed.`)
    return
  }

  console.error(`Not found: ${name}`)
  console.error('Run: pstack list')
  process.exit(1)
}

/**
 * Unified run command - handles stacks and prompts
 */
async function runItem(name, args) {
  // Check if it's a stack
  const stackPath = path.join(STACKS_DIR, name)
  if (fs.existsSync(stackPath)) {
    const depsOk = await ensureStackDependencies(name)
    if (!depsOk) {
      console.warn('Some dependencies failed to install.')
    }

    try {
      await makeAppRequest('POST', '/run', { stackId: name, args, cwd: process.cwd() })
    } catch (err) {
      console.error(`Error: ${err.message}`)
      console.error('Start the Prompt Stack app to run stacks.')
      process.exit(1)
    }
    return
  }

  // Check if it's a prompt
  const promptPath = path.join(PROMPTS_DIR, `${name}.md`)
  if (fs.existsSync(promptPath)) {
    // Determine which agent to use
    const agentFlag = args.find(a => a.startsWith('--agent='))
    let agent = agentFlag ? agentFlag.split('=')[1] : null

    if (!agent) {
      // Check config for default
      const config = loadConfig()
      agent = config.default_agent
    }

    if (!agent) {
      // Use first installed agent
      const agents = ['claude', 'codex', 'gemini']
      agent = agents.find(a => isRuntimeInstalled(a))
    }

    if (!agent) {
      console.error('No agent installed to run prompts.')
      console.error('Install one with: pstack install claude')
      process.exit(1)
    }

    // Filter out --agent flag from args
    const cleanArgs = args.filter(a => !a.startsWith('--agent='))

    try {
      await makeAppRequest('POST', '/run-prompt', {
        promptId: name,
        agent,
        args: cleanArgs,
        cwd: process.cwd()
      })
    } catch (err) {
      console.error(`Error: ${err.message}`)
      console.error('Start the Prompt Stack app to run prompts.')
      process.exit(1)
    }
    return
  }

  console.error(`Not found: ${name}`)
  console.error('Run: pstack list')
  process.exit(1)
}

/**
 * Show path to runtime binary
 */
async function showWhich(name) {
  const p = getRuntimePath(name)
  if (p) {
    console.log(p)
  } else {
    console.error(`Runtime '${name}' is not installed.`)
    console.error(`Install with: pstack install ${name}`)
    process.exit(1)
  }
}

/**
 * Update installed items
 */
async function updateItems(name = null) {
  if (name) {
    // Update specific item
    const type = await detectType(name)
    if (!type) {
      console.error(`Not found: ${name}`)
      process.exit(1)
    }

    console.log(`Updating ${name}...`)
    if (type === 'stack') {
      await installStack(name, true, false)
    } else if (type === 'prompt') {
      await installPrompt(name, true)
    } else {
      console.log('Runtime updates not yet supported.')
    }
    return
  }

  // Check all installed items
  console.log('\nChecking for updates...\n')

  try {
    const registry = await fetchRegistryIndex(true) // Force refresh

    // Check stacks
    const stacks = fs.readdirSync(STACKS_DIR).filter(f => !f.startsWith('.'))
    for (const stackId of stacks) {
      const local = parseStackManifest(path.join(STACKS_DIR, stackId))
      const remote = registry.stacks.find(s => s.id === stackId)

      if (remote && local?.version && remote.version) {
        if (remote.version !== local.version) {
          console.log(`  ${stackId.padEnd(24)} ${local.version} → ${remote.version} (update available)`)
        } else {
          console.log(`  ${stackId.padEnd(24)} ${local.version} (up to date)`)
        }
      } else {
        console.log(`  ${stackId.padEnd(24)} (version unknown)`)
      }
    }

    if (stacks.length === 0) {
      console.log('  No stacks installed.')
    }

    console.log('\nRun: pstack update <name> to update a specific item')

  } catch (err) {
    console.error(`Update check failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Handle search command
 */
async function handleSearch(query, args) {
  if (!query) {
    console.error('Usage: pstack search <query>')
    process.exit(1)
  }

  const typeFlag = args.find(a => a.startsWith('--type='))
  const type = typeFlag ? typeFlag.split('=')[1] : 'all'
  const refresh = args.includes('--refresh')

  if (refresh) {
    await fetchRegistryIndex(true)
  }

  console.log(`\nSearching for "${query}"...\n`)

  const results = await searchRegistry(query, { type })

  if (results.length === 0) {
    console.log('No results found.')
    return
  }

  // Group by type
  const grouped = { runtime: [], stack: [], prompt: [] }
  for (const r of results) {
    grouped[r.type].push(r)
  }

  for (const [type, items] of Object.entries(grouped)) {
    if (items.length === 0) continue
    const label = type.charAt(0).toUpperCase() + type.slice(1) + 's'
    console.log(`\x1b[1m${label}\x1b[0m`)

    for (const item of items) {
      const installed = item.installed ? '\x1b[32m(installed)\x1b[0m' : ''
      const cat = item.category ? `\x1b[90m[${item.category}]\x1b[0m` : ''
      console.log(`  ${item.id.padEnd(20)} ${item.name} ${cat} ${installed}`)
      console.log(`    \x1b[90m${item.description}\x1b[0m`)
    }
    console.log('')
  }
}

// ============================================================================
// STACK DEPENDENCY RESOLUTION
// ============================================================================

function parseStackManifest(stackPath) {
  const manifestPath = path.join(stackPath, 'STACK.md')
  if (!fs.existsSync(manifestPath)) return null

  const content = fs.readFileSync(manifestPath, 'utf-8')

  // Parse YAML frontmatter
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null

  const frontmatter = match[1]
  const manifest = {}

  // Parse simple YAML (id, name, requires)
  for (const line of frontmatter.split('\n')) {
    const [key, ...rest] = line.split(':')
    if (key && rest.length) {
      const value = rest.join(':').trim()
      manifest[key.trim()] = value
    }
  }

  // Parse requires section
  const requiresMatch = frontmatter.match(/requires:\n([\s\S]*?)(?=\n\w|$)/)
  if (requiresMatch) {
    manifest.requires = {}
    const requiresLines = requiresMatch[1].split('\n')
    for (const line of requiresLines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('runtimes:')) {
        const arr = trimmed.replace('runtimes:', '').trim()
        manifest.requires.runtimes = arr.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      } else if (trimmed.startsWith('pip:')) {
        const arr = trimmed.replace('pip:', '').trim()
        manifest.requires.pip = arr.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      } else if (trimmed.startsWith('npm:')) {
        const arr = trimmed.replace('npm:', '').trim()
        manifest.requires.npm = arr.replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean)
      }
    }
  }

  return manifest
}

async function ensureStackDependencies(stackId) {
  // Find the stack
  const stacksDir = path.join(os.homedir(), '.prompt-stack', 'stacks')
  const stackPath = path.join(stacksDir, stackId)

  if (!fs.existsSync(stackPath)) {
    console.error(`Stack not found: ${stackId}`)
    console.error(`Expected at: ${stackPath}`)
    return false
  }

  const manifest = parseStackManifest(stackPath)
  if (!manifest) {
    console.log(`No STACK.md found for ${stackId}, skipping dependency check`)
    return true
  }

  if (!manifest.requires) {
    console.log(`Stack ${stackId} has no dependencies declared`)
    return true
  }

  console.log(`\nChecking dependencies for ${manifest.name || stackId}...\n`)

  const requires = manifest.requires
  let allInstalled = true

  // 1. Check and install runtimes
  if (requires.runtimes && requires.runtimes.length > 0) {
    for (const runtime of requires.runtimes) {
      if (isRuntimeInstalled(runtime)) {
        console.log(`  ✓ ${runtime} - installed`)
      } else {
        console.log(`  ✗ ${runtime} - missing, installing...`)
        try {
          await downloadRuntime(runtime)
        } catch (err) {
          console.error(`    Failed to install ${runtime}: ${err.message}`)
          allInstalled = false
        }
      }
    }
  }

  // 2. Install pip packages
  if (requires.pip && requires.pip.length > 0) {
    const pythonPath = getRuntimePath('python')
    if (!pythonPath) {
      console.error('  ✗ Python required for pip packages but not installed')
      allInstalled = false
    } else {
      // pip3 is in same bin directory as python3
      const pipPath = path.join(path.dirname(pythonPath), 'pip3')
      console.log(`\n  Installing pip packages: ${requires.pip.join(', ')}`)
      try {
        // Add python's bin directory to PATH so pip's shebang can find python
        const pythonBinDir = path.dirname(pythonPath)
        const env = {
          ...process.env,
          PIP_DISABLE_PIP_VERSION_CHECK: '1',
          PATH: `${pythonBinDir}:${process.env.PATH || ''}`
        }

        execSync(`"${pipPath}" install ${requires.pip.join(' ')}`, {
          stdio: 'inherit',
          env
        })
        console.log('  ✓ pip packages installed')
      } catch (err) {
        console.error('  ✗ Failed to install pip packages')
        allInstalled = false
      }
    }
  }

  // 3. Install npm packages
  if (requires.npm && requires.npm.length > 0) {
    const npmPath = getRuntimePath('node')?.replace('node', 'npm') || 'npm'
    console.log(`\n  Installing npm packages: ${requires.npm.join(', ')}`)
    try {
      // Add node's bin directory to PATH so npm's shebang can find node
      const env = { ...process.env }
      const nodePath = getRuntimePath('node')
      if (nodePath) {
        const nodeBinDir = path.dirname(nodePath)
        env.PATH = `${nodeBinDir}:${env.PATH || ''}`
      }

      execSync(`"${npmPath}" install ${requires.npm.join(' ')}`, {
        cwd: stackPath,
        stdio: 'inherit',
        env
      })
      console.log('  ✓ npm packages installed')
    } catch (err) {
      console.error('  ✗ Failed to install npm packages')
      allInstalled = false
    }
  }

  console.log('')
  return allInstalled
}

// ============================================================================
// DATABASE COMMANDS
// ============================================================================

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

async function handleDbCommand(args) {
  const subcommand = args[0]

  switch (subcommand) {
    case 'init': {
      loadDbModules()
      const result = schemaModule.initSchema()
      console.log(`\n✓ Database ready at ${dbModule.getDbPath()}`)
      console.log(`  Schema version: ${result.version}`)
      const size = dbModule.getDbSize()
      if (size) console.log(`  Size: ${formatBytes(size)}`)
      dbModule.closeDb()
      break
    }

    case 'migrate': {
      loadImportModule()
      schemaModule.initSchema()
      const result = importModule.migrateFromJson()
      console.log(`\n✓ Migration complete`)
      console.log(`  Sessions migrated: ${result.sessions}`)
      console.log(`  Projects migrated: ${result.projects}`)
      if (result.skipped > 0) {
        console.log(`  Skipped (already exist): ${result.skipped}`)
      }
      dbModule.closeDb()
      break
    }

    case 'import': {
      loadImportModule()
      schemaModule.initSchema()
      const force = args.includes('--force')
      const includeDead = args.includes('--include-dead')
      const provider = args.find(a => a.startsWith('--provider='))?.split('=')[1]
      const skipTitleInference = args.includes('--skip-title-inference')

      console.log('\nImporting sessions from native provider directories...\n')

      const result = importModule.importFromProviders({
        skipExisting: !force,
        skipDead: !includeDead,
        provider,
        inferTitles: !skipTitleInference
      })

      console.log('Import complete:\n')
      for (const [prov, stats] of Object.entries(result)) {
        if (prov === 'errors') continue
        console.log(`  ${prov.padEnd(8)} ${stats.imported} imported, ${stats.skipped} skipped, ${stats.turns || 0} turns`)
      }

      if (result.errors && result.errors.length > 0) {
        console.log(`\n  Errors: ${result.errors.length}`)
        for (const err of result.errors.slice(0, 5)) {
          console.log(`    - ${err}`)
        }
        if (result.errors.length > 5) {
          console.log(`    ... and ${result.errors.length - 5} more`)
        }
      }

      dbModule.closeDb()
      break
    }

    case 'search': {
      loadSearchModule()
      if (!dbModule.isDatabaseInitialized()) {
        console.error('Database not initialized. Run: pstack db init')
        process.exit(1)
      }

      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ')
      if (!query) {
        console.error('Usage: pstack db search <query>')
        process.exit(1)
      }

      const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20')
      const provider = args.find(a => a.startsWith('--provider='))?.split('=')[1]

      const results = searchModule.search(query, { limit, provider })

      if (results.length === 0) {
        console.log(`\nNo results found for "${query}"`)
      } else {
        console.log(`\nFound ${results.length} results for "${query}":\n`)
        for (const r of results) {
          const title = r.session_title || 'Untitled'
          const date = new Date(r.ts).toLocaleDateString()
          console.log(`  [${r.provider}] ${title} (${date})`)
          console.log(`    Turn #${r.turn_number}: ${r.user_message?.substring(0, 100)}...`)
          console.log('')
        }
      }

      dbModule.closeDb()
      break
    }

    case 'sessions': {
      loadDbModules()
      if (!dbModule.isDatabaseInitialized()) {
        console.error('Database not initialized. Run: pstack db init')
        process.exit(1)
      }

      const provider = args.find(a => a.startsWith('--provider='))?.split('=')[1]
      const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '20')
      const showDeleted = args.includes('--deleted')

      const db = dbModule.getDb()
      let sql = 'SELECT * FROM sessions WHERE 1=1'
      const params = []

      if (provider) {
        sql += ' AND provider = ?'
        params.push(provider)
      }

      if (!showDeleted) {
        sql += ' AND status != ?'
        params.push('deleted')
      }

      sql += ' ORDER BY last_active_at DESC LIMIT ?'
      params.push(limit)

      const sessions = db.prepare(sql).all(...params)

      if (sessions.length === 0) {
        console.log('\nNo sessions found.')
      } else {
        console.log(`\nSessions (${sessions.length}):\n`)
        for (const s of sessions) {
          const date = new Date(s.last_active_at).toLocaleDateString()
          const title = s.title || 'Untitled'
          const cost = s.total_cost ? `$${s.total_cost.toFixed(4)}` : ''
          console.log(`  [${s.provider}] ${title.substring(0, 50).padEnd(50)} ${s.turn_count || 0} turns  ${cost.padStart(8)}  ${date}`)
        }
      }

      dbModule.closeDb()
      break
    }

    case 'stats': {
      loadStatsModule()
      if (!dbModule.isDatabaseInitialized()) {
        console.error('Database not initialized. Run: pstack db init')
        process.exit(1)
      }

      const stats = statsModule.getStats()

      console.log('\n╔════════════════════════════════════════════════════════╗')
      console.log('║           Prompt Stack Usage Statistics                ║')
      console.log('╚════════════════════════════════════════════════════════╝\n')

      console.log(`  Total Sessions:  ${stats.totalSessions}`)
      console.log(`  Total Turns:     ${stats.totalTurns}`)
      console.log(`  Total Cost:      $${stats.totalCost.toFixed(2)}`)
      console.log(`  Input Tokens:    ${stats.totalInputTokens?.toLocaleString() || 0}`)
      console.log(`  Output Tokens:   ${stats.totalOutputTokens?.toLocaleString() || 0}`)

      if (Object.keys(stats.byProvider).length > 0) {
        console.log('\n  By Provider:')
        for (const [provider, data] of Object.entries(stats.byProvider)) {
          console.log(`    ${provider.padEnd(10)} ${String(data.sessions).padStart(5)} sessions  ${String(data.turns || 0).padStart(6)} turns  $${data.cost.toFixed(2)}`)
        }
      }

      if (stats.byModel && stats.byModel.length > 0) {
        console.log('\n  By Model (top 5):')
        for (const row of stats.byModel.slice(0, 5)) {
          if (row.model) {
            console.log(`    ${row.model.substring(0, 30).padEnd(30)} ${String(row.turns).padStart(5)} turns  $${(row.cost || 0).toFixed(2)}`)
          }
        }
      }

      console.log('')
      dbModule.closeDb()
      break
    }

    case 'path': {
      loadDbModules()
      console.log(dbModule.getDbPath())
      break
    }

    case 'info': {
      loadDbModules()
      const dbPath = dbModule.getDbPath()
      const exists = dbModule.isDatabaseInitialized()

      console.log('\nPrompt Stack Database Info:\n')
      console.log(`  Path:        ${dbPath}`)
      console.log(`  Exists:      ${exists ? 'Yes' : 'No'}`)

      if (exists) {
        const size = dbModule.getDbSize()
        const version = schemaModule.getSchemaVersion()
        const tables = schemaModule.getTableNames()

        console.log(`  Size:        ${formatBytes(size)}`)
        console.log(`  Schema:      v${version}`)
        console.log(`  Tables:      ${tables.join(', ')}`)

        console.log('\n  Row counts:')
        for (const table of tables) {
          if (table !== 'schema_version' && !table.endsWith('_fts')) {
            const count = schemaModule.getTableCount(table)
            console.log(`    ${table.padEnd(15)} ${count}`)
          }
        }
      }

      console.log('')
      dbModule.closeDb()
      break
    }

    default:
      console.log(`
pstack db - Database management commands

Usage:
  pstack db init                    Initialize database with schema
  pstack db migrate                 Migrate from existing sessions.json
  pstack db import [options]        Import from native provider files
  pstack db search <query>          Full-text search across all turns
  pstack db sessions [options]      List sessions
  pstack db stats                   Show usage statistics
  pstack db path                    Print database file path
  pstack db info                    Show database info

Import options:
  --force                           Re-import existing sessions
  --include-dead                    Include empty/test sessions
  --provider=<name>                 Only import from specific provider
  --skip-title-inference            Leave imported titles blank (no prompt-derived default)

Sessions options:
  --provider=<name>                 Filter by provider
  --limit=<n>                       Limit results (default: 20)
  --deleted                         Include deleted sessions

Search options:
  --limit=<n>                       Limit results (default: 20)
  --provider=<name>                 Filter by provider
`)
  }
}

// ============================================================================
// MAIN (v2.0)
// ============================================================================

async function main() {
  const args = process.argv.slice(2)

  // Handle flags first
  if (args.includes('-h') || args.includes('--help')) {
    showHelp()
    return
  }

  if (args.includes('-v') || args.includes('--version')) {
    console.log(`pstack v${VERSION}`)
    return
  }

  // No args = dashboard
  if (args.length === 0) {
    await showDashboard()
    return
  }

  const command = args[0]
  const name = args[1]
  const restArgs = args.slice(2)

  switch (command) {
    // === NEW v2.0 COMMANDS ===

    case 'search':
      await handleSearch(name, restArgs)
      break

    case 'install':
      if (!name) {
        console.error('Usage: pstack install <name>')
        process.exit(1)
      }
      await installItem(name, {
        force: args.includes('--force'),
        skipDeps: args.includes('--skip-deps')
      })
      break

    case 'run':
      if (!name) {
        console.error('Usage: pstack run <name> [args...]')
        process.exit(1)
      }
      await runItem(name, restArgs)
      break

    case 'list':
      await showList()
      break

    case 'remove':
    case 'uninstall':
      if (!name) {
        console.error('Usage: pstack remove <name>')
        process.exit(1)
      }
      await removeItem(name)
      break

    case 'which':
      if (!name) {
        console.error('Usage: pstack which <runtime>')
        process.exit(1)
      }
      await showWhich(name)
      break

    case 'update':
      await updateItems(name || null)
      break

    // === DATABASE (unchanged) ===

    case 'db':
      await handleDbCommand(args.slice(1))
      break

    // === LEGACY COMMANDS (migration messages) ===

    case 'runtime':
      console.error('\x1b[33m⚠️  The "pstack runtime" command was removed in v2.0\x1b[0m')
      console.error('')
      console.error('Migration guide:')
      console.error('  pstack runtime list        →  pstack list')
      console.error('  pstack runtime ensure <X>  →  pstack install <X>')
      console.error('  pstack runtime uninstall   →  pstack remove <X>')
      console.error('  pstack runtime path <X>    →  pstack which <X>')
      console.error('  pstack runtime info <X>    →  pstack list (then pstack which <X>)')
      process.exit(1)
      break

    case 'deps':
      console.error('\x1b[33m⚠️  The "pstack deps" command was removed in v2.0\x1b[0m')
      console.error('')
      console.error('Dependencies are now auto-installed when you run:')
      console.error('  pstack install <stack>')
      console.error('  pstack run <stack>')
      process.exit(1)
      break

    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run "pstack --help" for usage.')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err.message)
  process.exit(1)
})
