// bcryptjs, not the native `bcrypt` package: bcryptjs is a pure-JS
// implementation of the same algorithm, so there's no native addon to
// compile (which regularly breaks on fresh machines/CI images/Docker base
// image changes). It's slightly slower than native bcrypt under heavy load,
// which is a completely reasonable trade to make for a bootcamp project or
// a small-to-mid production app; a high-traffic auth service is the point
// at which you'd revisit that trade-off, not before.
import bcrypt from 'bcryptjs';

// Higher salt rounds = slower to hash = slower for an attacker to brute
// force = also slower for YOUR server on every signup/login. 12 is the
// well-established floor for production in 2026; going much higher just to
// feel safe measurably slows down your login endpoint for limited benefit.
const SALT_ROUNDS = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, SALT_ROUNDS);
}

export async function verifyPassword(plainTextPassword: string, storedHash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, storedHash);
}
