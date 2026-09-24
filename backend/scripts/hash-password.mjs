// Generates an scrypt password hash for the ADMIN_PASSWORD_HASH setting.
// Usage: npm run hash:password -- <your-password>
// This script does NOT read .env and never prints or exposes any existing secret.
import { randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash:password -- <your-password>');
  process.exit(1);
}

const N = 16384;
const r = 8;
const p = 1;
const keylen = 64;
const salt = randomBytes(16);
const derived = await scryptAsync(password, salt, keylen, { N, r, p });

console.log(`scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${derived.toString('base64')}`);