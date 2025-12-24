/**
 * Secrets command - manage secrets
 */

import {
  setSecret,
  removeSecret,
  listSecretNames,
  getMaskedSecrets,
  exportToEnv,
  loadSecrets
} from '@prompt-stack/runner';
import readline from 'readline';

export async function cmdSecrets(args, flags) {
  const subcommand = args[0];

  switch (subcommand) {
    case 'set':
      await secretsSet(args.slice(1), flags);
      break;

    case 'list':
    case 'ls':
      secretsList(flags);
      break;

    case 'remove':
    case 'rm':
    case 'delete':
      secretsRemove(args.slice(1), flags);
      break;

    case 'export':
      secretsExport(flags);
      break;

    default:
      console.log(`
pstack secrets - Manage secrets

COMMANDS
  set <name>       Set a secret (prompts for value)
  list             List configured secrets (values masked)
  remove <name>    Remove a secret
  export           Export as environment variables

EXAMPLES
  pstack secrets set VERCEL_TOKEN
  pstack secrets list
  pstack secrets remove GITHUB_TOKEN
`);
  }
}

async function secretsSet(args, flags) {
  const name = args[0];

  if (!name) {
    console.error('Usage: pstack secrets set <name>');
    console.error('Example: pstack secrets set VERCEL_TOKEN');
    process.exit(1);
  }

  // Validate name format
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error('Secret name should be UPPER_SNAKE_CASE');
    console.error('Example: VERCEL_TOKEN, GITHUB_API_KEY');
    process.exit(1);
  }

  // Check if already exists
  const existing = loadSecrets();
  if (existing[name] && !flags.force) {
    console.log(`Secret ${name} already exists.`);
    console.log('Use --force to overwrite.');
    process.exit(0);
  }

  // Prompt for value
  const value = await promptSecret(`Enter value for ${name}: `);

  if (!value) {
    console.error('No value provided');
    process.exit(1);
  }

  setSecret(name, value);
  console.log(`✓ Secret ${name} saved`);
}

function secretsList(flags) {
  const names = listSecretNames();

  if (names.length === 0) {
    console.log('No secrets configured.');
    console.log('\nSet with: pstack secrets set <name>');
    return;
  }

  if (flags.json) {
    console.log(JSON.stringify(getMaskedSecrets(), null, 2));
    return;
  }

  const masked = getMaskedSecrets();

  console.log('\nConfigured secrets:');
  console.log('─'.repeat(50));

  for (const name of names.sort()) {
    console.log(`  ${name.padEnd(25)} ${masked[name]}`);
  }

  console.log(`\nTotal: ${names.length} secret(s)`);
}

function secretsRemove(args, flags) {
  const name = args[0];

  if (!name) {
    console.error('Usage: pstack secrets remove <name>');
    process.exit(1);
  }

  const existing = loadSecrets();
  if (!existing[name]) {
    console.error(`Secret not found: ${name}`);
    process.exit(1);
  }

  if (!flags.force && !flags.y) {
    console.log(`This will remove secret: ${name}`);
    console.log('Run with --force to confirm.');
    process.exit(0);
  }

  removeSecret(name);
  console.log(`✓ Secret ${name} removed`);
}

function secretsExport(flags) {
  const exports = exportToEnv();

  if (!exports) {
    console.log('No secrets to export.');
    return;
  }

  console.log('# Add to your shell profile:');
  console.log(exports);
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
