# pstack-cli

Command-line interface for Prompt Stack - runtime and database management.

## Installation

```bash
npm install -g pstack-cli
```

## Commands

### Runtime Management

```bash
pstack list              # List all available runtimes
pstack install <runtime> # Install a runtime
pstack check <runtime>   # Check if runtime is installed
pstack run <runtime>     # Run a command with a runtime
```

### Database Commands

```bash
pstack db init           # Initialize the database
pstack db import         # Import sessions
pstack db search         # Search conversations
pstack db stats          # Show statistics
```

### Stack Commands (requires Prompt Stack app)

```bash
pstack stack list        # List available stacks
pstack stack run <name>  # Run a stack
```

## Supported Runtimes

**Core:** node, python, deno, bun
**Agents:** claude, codex, gemini, copilot, ollama
**Tools:** git, ffmpeg, imagemagick, pandoc, chromium, jq, yq, sqlite, psql, httpie, tesseract, ytdlp, ripgrep
**Cloud:** supabase, vercel, netlify, wrangler, railway, flyio

## License

MIT
