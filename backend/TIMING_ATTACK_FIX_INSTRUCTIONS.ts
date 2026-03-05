
// FIX #8: Pre-computed dummy hash prevents timing attacks on non-existent users
// Place this at module scope (top of file, after imports)
import bcrypt from 'bcrypt';
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
// Pre-compute once at startup — never re-compute per request
let DUMMY_HASH: string;
(async () => {
  DUMMY_HASH = await bcrypt.hash('dummy-timing-protection-' + Math.random(), BCRYPT_ROUNDS);
})();

// In your login handler, ALWAYS run bcrypt.compare even for unknown users:
// const hashToCheck = user ? user.password_hash : DUMMY_HASH;
// const isValid = await bcrypt.compare(password, hashToCheck);
// if (!user || !isValid) throw new UnauthorizedError('Invalid credentials');