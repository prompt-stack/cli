/**
 * Migrate command removed.
 * No backwards compatibility is supported.
 */

export async function cmdMigrate() {
  console.error('rudi migrate has been removed. No backwards compatibility is supported.');
  process.exit(1);
}
