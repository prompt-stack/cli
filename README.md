# RUDI CLI

Install and manage MCP stacks, runtimes, and AI agents.

## Install

```bash
npm i -g @learnrudi/cli
```

Requires Node.js + npm. The npm postinstall step bootstraps `~/.rudi` and
downloads the default runtimes.

## Installation Flow (CLI + Studio)

### CLI (npm)

1. `npm i -g @learnrudi/cli` downloads the CLI package.
2. Postinstall creates `~/.rudi/` folders, downloads Node/Python runtimes,
   creates `~/.rudi/shims/rudi-mcp`, and initializes `~/.rudi/secrets.json`.
3. Run `rudi init` to create `~/.rudi/rudi.db`, write `settings.json`, and
   ensure essential binaries and shims are present.

### Studio (desktop app)

1. Studio bundles the CLI and installs it to `~/.rudi/bins/rudi`.
2. On first launch, Studio runs `rudi init` unless `~/.rudi` is already
   initialized.
3. CLI and Studio share the same `~/.rudi` home, so stacks, runtimes, secrets,
   and the database stay in sync.

If you already use Studio, you can skip the npm install unless you want the
`rudi` command in your shell. If you already use the CLI, Studio will reuse the
existing `~/.rudi` setup.

## Quick Start

```bash
# Search available stacks
rudi search --all

# Install a stack
rudi install slack

# Configure secrets
rudi secrets set SLACK_BOT_TOKEN "xoxb-your-token"

# Wire up your agents (Claude, Gemini, VS Code, etc.)
rudi integrate all

# Restart your agent to use the new stack
```

## Commands

```bash
rudi search <query>       # Search for packages
rudi search --all         # List all packages
rudi install <pkg>        # Install a package
rudi remove <pkg>         # Remove a package
rudi list [kind]          # List installed (stacks, runtimes, binaries, agents)
rudi secrets list         # Show configured secrets
rudi secrets set <key>    # Set a secret
rudi integrate <agent>    # Wire stack to agent config
rudi update [pkg]         # Update packages
rudi doctor               # Check system health
```

## How It Works

1. `rudi install slack` downloads the MCP server tarball from GitHub releases
2. Extracts to `~/.rudi/stacks/slack/`
3. Runs `npm install` to install dependencies
4. Shows which secrets need to be configured

When an agent runs the stack:
1. Agent config points to `~/.rudi/shims/rudi-mcp`
2. Shim calls `rudi mcp slack`
3. RUDI loads secrets from `~/.rudi/secrets.json`
4. Injects secrets as environment variables
5. Runs the MCP server with bundled runtime

## Directory Structure

```
~/.rudi/
├── stacks/           # Installed MCP stacks
├── runtimes/         # Bundled Node.js, Python
├── tools/            # Binaries (ffmpeg, ripgrep, etc.)
├── shims/            # Shim scripts for agent configs
├── secrets.json      # Encrypted secrets (0600 permissions)
└── rudi.db           # Local database
```

## Available Stacks

| Stack | Description |
|-------|-------------|
| slack | Send messages, search channels, manage reactions |
| google-workspace | Gmail, Sheets, Docs, Drive, Calendar |
| notion-workspace | Pages, databases, search |
| google-ai | Gemini, Imagen, Veo |
| openai | DALL-E, Whisper, TTS, Sora |
| postgres | PostgreSQL database queries |
| video-editor | ffmpeg-based video editing |
| content-extractor | YouTube, Reddit, TikTok, articles |
| github | Issues, PRs, repos, actions |
| stripe | Payments, subscriptions, invoices |

## Links

- Website: https://learnrudi.com
- Registry: https://github.com/learn-rudi/registry
- Issues: https://github.com/learn-rudi/cli/issues
