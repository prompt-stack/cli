/**
 * Secrets command - manage secrets in secure storage
 *
 * Uses macOS Keychain when available, falls back to encrypted JSON.
 * Secrets are used by `rudi mcp` to inject env vars at runtime.
 */

import readline from 'readline';
import {
  getSecret,
  setSecret,
  removeSecret,
  listSecrets,
  hasSecret,
  getMaskedSecrets,
  getStorageInfo,
} from '@learnrudi/secrets';

export async function cmdSecrets(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'set':
      await secretsSet(args.slice(1), flags);
      break;

    case 'get':
      await secretsGet(args.slice(1), flags);
      break;

    case 'list':
    case 'ls':
      await secretsList(flags);
      break;

    case 'remove':
    case 'rm':
    case 'delete':
      await secretsRemove(args.slice(1), flags);
      break;

    case 'info':
      secretsInfo();
      break;

    default:
      console.log(`
rudi secrets - Manage secrets (stored in ${getStorageInfo().backend})

COMMANDS
  set <name>       Set a secret (prompts for value securely)
  get <name>       Get a secret value (for scripts)
  list             List configured secrets (values masked)
  remove <name>    Remove a secret
  info             Show storage backend info

EXAMPLES
  rudi secrets set SLACK_BOT_TOKEN
  rudi secrets list
  rudi secrets remove GITHUB_TOKEN

SECURITY
  Secrets are stored in macOS Keychain when available.
  Fallback uses encrypted JSON at ~/.rudi/secrets.json
`);
  }
}

async function secretsSet(args, flags) {
  const name = args[0];
  const valueArg = args[1]; // Value can be passed as second argument

  if (!name) {
    console.error('Usage: rudi secrets set <name> [value]');
    console.error('');
    console.error('Examples:');
    console.error('  rudi secrets set SLACK_BOT_TOKEN              # Interactive prompt');
    console.error('  rudi secrets set SLACK_BOT_TOKEN "xoxb-..."   # Direct value');
    process.exit(1);
  }

  // Validate name format
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error('Secret name should be UPPER_SNAKE_CASE');
    console.error('Example: SLACK_BOT_TOKEN, GITHUB_API_KEY');
    process.exit(1);
  }

  // Check if already exists
  const exists = await hasSecret(name);
  if (exists && !flags.force) {
    console.log(`Secret ${name} already exists.`);
    console.log('Use --force to overwrite.');
    process.exit(0);
  }

  let value = valueArg;

  // If no value provided, try interactive prompt (only works in real TTY)
  if (!value) {
    if (process.stdin.isTTY) {
      value = await promptSecret(`Enter value for ${name}: `);
    } else {
      console.error('No value provided.');
      console.error('Usage: rudi secrets set <name> <value>');
      process.exit(1);
    }
  }

  if (!value) {
    console.error('No value provided');
    process.exit(1);
  }

  await setSecret(name, value);
  const info = getStorageInfo();
  console.log(`✓ Secret ${name} saved (${info.backend})`);
}

async function secretsGet(args, flags) {
  const name = args[0];

  if (!name) {
    console.error('Usage: rudi secrets get <name>');
    process.exit(1);
  }

  const value = await getSecret(name);
  if (value) {
    // Output raw value (for scripts)
    process.stdout.write(value);
  } else {
    process.exit(1);
  }
}

async function secretsList(flags) {
  const names = await listSecrets();

  if (names.length === 0) {
    console.log('No secrets configured.');
    console.log('\nSet with: rudi secrets set <name>');
    return;
  }

  if (flags.json) {
    const masked = await getMaskedSecrets();
    console.log(JSON.stringify(masked, null, 2));
    return;
  }

  const masked = await getMaskedSecrets();
  const info = getStorageInfo();

  // Count configured vs pending
  const pending = Object.values(masked).filter(v => v === '(pending)').length;
  const configured = names.length - pending;

  console.log(`\nSecrets (${info.backend}):`);
  console.log('─'.repeat(50));

  for (const name of names) {
    const status = masked[name] === '(pending)' ? '○' : '✓';
    console.log(`  ${status} ${name.padEnd(28)} ${masked[name]}`);
  }

  console.log('─'.repeat(50));
  if (pending > 0) {
    console.log(`  ${configured} configured, ${pending} pending`);
    console.log(`\n  Set pending: rudi secrets set <name> "<value>"`);
  } else {
    console.log(`  ${configured} configured`);
  }
}

async function secretsRemove(args, flags) {
  const name = args[0];

  if (!name) {
    console.error('Usage: rudi secrets remove <name>');
    process.exit(1);
  }

  // Check if key exists in secrets (including empty placeholders)
  const allNames = await listSecrets();
  if (!allNames.includes(name)) {
    console.error(`Secret not found: ${name}`);
    process.exit(1);
  }

  if (!flags.force && !flags.y) {
    console.log(`This will remove secret: ${name}`);
    console.log('Run with --force to confirm.');
    process.exit(0);
  }

  await removeSecret(name);
  console.log(`✓ Secret ${name} removed`);
}

function secretsInfo() {
  const info = getStorageInfo();
  console.log('\nSecrets Storage:');
  console.log('─'.repeat(50));
  console.log(`  Backend: ${info.backend}`);
  console.log(`  File: ${info.file}`);
  console.log(`  Permissions: ${info.permissions}`);
  console.log('');
  console.log('  Security: File permissions (0600) protect secrets.');
  console.log('  Same approach as AWS CLI, SSH, GitHub CLI.');
}

/**
 * Prompt for a secret value (hidden input)
 */
function promptSecret(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Hide input
    process.stdout.write(prompt);

    let input = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onData);
        console.log();
        rl.close();
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else if (char === '\u007f') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}
