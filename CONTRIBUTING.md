# Contributing to RUDI CLI

Thank you for your interest in contributing to RUDI CLI.

## Getting Started

### Prerequisites

- Node.js 18 or later
- pnpm (for monorepo workspace management)

### Setup

```bash
git clone https://github.com/learn-rudi/cli.git
cd cli
pnpm install
```

### Project Structure

```
cli/
├── src/                    # Main CLI source
│   ├── index.js           # Entry point and command routing
│   └── commands/          # Command implementations
├── packages/              # Monorepo packages
│   ├── core/              # Installation, resolution, detection
│   ├── db/                # SQLite database layer
│   ├── embeddings/        # Vector embeddings for search
│   ├── env/               # Paths and platform detection
│   ├── manifest/          # YAML/JSON manifest parsing
│   ├── mcp/               # MCP agent detection
│   ├── registry-client/   # Registry fetch and cache
│   ├── runner/            # Process spawning and streaming
│   ├── secrets/           # Secret storage
│   └── utils/             # Shared utilities
├── docs/                  # GitHub Pages documentation
└── dist/                  # Built output
```

### Building

```bash
npm run build
```

### Testing

```bash
# Run all tests
npm test

# Run tests for a specific package
cd packages/core && npm test
cd packages/db && npm test
```

## How to Contribute

### Reporting Issues

- Search existing issues before creating a new one
- Include Node.js version, OS, and RUDI version
- Provide steps to reproduce the issue
- Include relevant error messages or logs

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass (`npm test`)
6. Commit with a descriptive message
7. Push to your fork
8. Open a pull request

### Commit Messages

Use clear, descriptive commit messages:

```
Add support for Python runtime detection

- Add detect.command support in resolver
- Handle virtual environments
- Add tests for Python path resolution
```

### Code Style

- Use ES modules (`import`/`export`)
- No semicolons (project convention)
- Use async/await for asynchronous code
- Add JSDoc comments for public APIs
- Keep functions focused and small

### Adding a New Package

When adding support for a new MCP stack or binary:

1. Add the package definition to the registry at [learn-rudi/registry](https://github.com/learn-rudi/registry)
2. Include required secrets in the manifest
3. Test installation and integration locally
4. Update documentation if needed

### Adding a New Command

1. Create a new file in `src/commands/`
2. Export a `cmd<Name>` function that accepts `(args, flags)`
3. Add the command to the router in `src/index.js`
4. Add help text in `packages/utils/src/help.js`
5. Add tests in `src/__tests__/`

## Development Tips

### Testing MCP Integration

```bash
# Install a stack locally
rudi install slack

# Check the integration
rudi integrate claude --dry-run

# Verify secrets
rudi secrets list
```

### Debugging

```bash
# Run with verbose output
rudi doctor --verbose

# Check shim targets
rudi shims check

# Inspect a package
rudi pkg slack
```

### Local Registry Development

To test against a local registry:

```bash
# Set local registry path
export RUDI_REGISTRY_PATH=/path/to/local/registry

# Or modify the registry URL in packages/registry-client/src/index.js
```

## Questions

If you have questions about contributing, open a discussion on GitHub or reach out via issues.

## License

By contributing to RUDI CLI, you agree that your contributions will be licensed under the MIT License.
