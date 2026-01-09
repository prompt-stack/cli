# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | Yes                |
| < 1.0   | No                 |

## Security Model

### Secret Storage

RUDI stores secrets in `~/.rudi/secrets.json` with file permissions `0600` (owner read/write only). This follows the same security model used by:

- SSH (`~/.ssh/`)
- AWS CLI (`~/.aws/credentials`)
- GitHub CLI (`~/.config/gh/`)

Secrets are:
- Never written to agent configuration files
- Never exposed in process listings
- Never logged or transmitted
- Injected as environment variables only at runtime

### npm Package Installation

By default, RUDI installs npm packages with `--ignore-scripts` to prevent arbitrary code execution during installation. This mitigates supply chain attacks from malicious postinstall scripts.

Users must explicitly opt-in with `--allow-scripts` for packages that require lifecycle scripts.

### Shim Isolation

Each package installs to its own isolated directory. Shims are thin wrapper scripts that:
- Set up the correct environment
- Delegate to the actual binary
- Prevent packages from interfering with each other

### MCP Server Execution

When running MCP servers:
1. Secrets are loaded from the local secrets file
2. Injected as environment variables into the server process
3. The server runs with the user's permissions
4. No elevated privileges are requested or used

## Reporting a Vulnerability

If you discover a security vulnerability in RUDI CLI, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email security concerns to the maintainers
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We aim to respond to security reports within 48 hours and will work with you to understand and address the issue.

## Security Best Practices

When using RUDI CLI:

1. **Keep RUDI updated** - Run `npm update -g @learnrudi/cli` regularly
2. **Review packages before installing** - Check the registry for package details
3. **Protect your secrets file** - Ensure `~/.rudi/secrets.json` has mode 0600
4. **Use --allow-scripts sparingly** - Only enable scripts for trusted packages
5. **Audit installed packages** - Run `rudi list` and `rudi shims check` periodically

## Scope

This security policy covers:
- The RUDI CLI tool (`@learnrudi/cli`)
- The official package registry (`learn-rudi/registry`)
- Associated npm packages (`@learnrudi/*`)

Third-party MCP stacks and binaries installed through RUDI are maintained by their respective authors and have their own security policies.
