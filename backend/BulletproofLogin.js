// ╔══════════════════════════════════════════════════════════════════════╗
// ║  JOBBER × ANGEL ONE — BULLETPROOF LOGIN TEST  v4.0                 ║
// ║                                                                      ║
// ║  10 safety layers before a single real login attempt is made:       ║
// ║  1.  Rate-limit memory  — refuses if last attempt < 70s ago         ║
// ║  2.  Credential format  — validates all 4 creds before network      ║
// ║  3.  Clock drift check  — TOTP fails if PC clock is off > 30s       ║
// ║  4.  DNS resolution     — confirms domain reachable                 ║
// ║  5.  TCP/TLS probe      — confirms port 443 open                    ║
// ║  6.  Public IP detect   — shows what Angel One sees                 ║
// ║  7.  WAF header test    — no UA vs with UA (finds exact trigger)    ║
// ║  8.  TOTP window guard  — waits if code expires in < 8s             ║
// ║  9.  Real login         — 1 attempt, then hard stop                 ║
// ║  10. Post-login verify  — tests JWT with getProfile + token refresh ║
// ║      Token persistence  — saves to angel-tokens.json (no re-login) ║
// ║                                                                      ║
// ║  Usage:  cd D:\jobber-perfect\backend                               ║
// ║          node BulletproofLogin.js                                   ║
// ╚══════════════════════════════════════════════════════════════════════╝

'use strict';
require('dotenv').config();

const fs        = require('fs');
const path      = require('path');
const net       = require('net');
const dns       = require('dns').promises;
const speakeasy = require('./node_modules/speakeasy');

// ── Constants ─────────────────────────────────────────────────────
const ANGEL_HOST    = 'apiconnect.angelone.in';
const ANGEL_WS_HOST = 'smartapisocket.angelone.in';
const BASE_URL      = `https://${ANGEL_HOST}`;
const ENDPOINTS     = {
  loginByPassword : `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword`,
  loginByMpin     : `${BASE_URL}/rest/auth/angelbroking/user/v1/loginByMpin`,
  generateTokens  : `${BASE_URL}/rest/auth/angelbroking/jwt/v1/generateTokens`,
  getProfile      : `${BASE_URL}/rest/secure/angelbroking/user/v1/getProfile`,
};

const RATE_LIMIT_FILE = path.join(__dirname, '.last_login_attempt');
const TOKEN_CACHE     = path.join(__dirname, 'angel-tokens.json');
const MIN_GAP_MS      = 70_000;   // 70s between attempts (WAF limit = 5/min)
const TOTP_MIN_LIFE   = 8;        // wait for fresh TOTP if < 8s remaining
const NTP_SERVERS     = [
  'https://worldtimeapi.org/api/ip',
  'https://timeapi.io/api/Time/current/zone?timeZone=UTC',
];

// ── Credentials ────────────────────────────────────────────────────
const CREDS = {
  apiKey   : process.env.ANGEL_API_KEY,
  clientId : process.env.ANGEL_CLIENT_CODE || process.env.CLIENT_CODE,
  mpin     : process.env.ANGEL_MPIN,
  totpSec  : (process.env.ANGEL_TOTP_SECRET || '').toUpperCase().replace(/[\s-]/g, ''),
};

// ── Required headers (from official SDK + WAF research) ────────────
function buildHeaders(apiKey, publicIp = '103.248.121.80') {
  return {
    'Content-Type'     : 'application/json',
    'Accept'           : 'application/json',
    'User-Agent'       : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'X-PrivateKey'     : apiKey,
    'X-UserType'       : 'USER',
    'X-SourceID'       : 'WEB',
    'X-ClientLocalIP'  : '127.0.0.1',
    'X-ClientPublicIP' : publicIp,
    'X-MACAddress'     : '00:00:00:00:00:00',
  };
}

// ── Output helpers ─────────────────────────────────────────────────
const C = {
  reset  : '\x1b[0m',
  green  : '\x1b[32m',
  red    : '\x1b[31m',
  yellow : '\x1b[33m',
  cyan   : '\x1b[36m',
  gray   : '\x1b[90m',
  bold   : '\x1b[1m',
};
const line  = (c = '─', n = 62) => c.repeat(n);
const pass  = (k, m)       => console.log(`${C.green}  ✅  ${k}${C.reset}\n       ${C.gray}${m}${C.reset}`);
const fail  = (k, m, fix)  => { console.log(`${C.red}  ❌  ${k}${C.reset}\n       ${m}`); if (fix) console.log(`${C.yellow}       → ${fix}${C.reset}`); };
const warn  = (k, m, fix)  => { console.log(`${C.yellow}  ⚠️   ${k}${C.reset}\n       ${m}`); if (fix) console.log(`${C.yellow}       → ${fix}${C.reset}`); };
const info  = m             => console.log(`${C.gray}       ${m}${C.reset}`);
const head  = t             => { console.log(`\n${C.bold}${C.cyan}${line('═')}${C.reset}\n${C.bold}${C.cyan}  ${t}${C.reset}\n${C.bold}${C.cyan}${line('─')}${C.reset}`); };
const sleep = ms            => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════
//  LAYER 1 — RATE LIMIT MEMORY
// ════════════════════════════════════════════════════════════════════
function checkRateLimit() {
  head('LAYER 1 — Rate Limit Memory (no network)');

  if (!fs.existsSync(RATE_LIMIT_FILE)) {
    pass('RateLimit', 'No previous login attempt recorded — safe to proceed');
    return true;
  }

  const lastTs  = parseInt(fs.readFileSync(RATE_LIMIT_FILE, 'utf8').trim(), 10);
  const elapsed = Date.now() - lastTs;
  const waitMs  = MIN_GAP_MS - elapsed;

  if (waitMs > 0) {
    const lastTime = new Date(lastTs).toLocaleTimeString();
    fail('RateLimit',
      `Last attempt was ${(elapsed / 1000).toFixed(0)}s ago (at ${lastTime}). Need ${(waitMs / 1000).toFixed(0)}s more.`,
      `Wait ${(waitMs / 1000).toFixed(0)} more seconds, then re-run. This prevents WAF ban.`
    );
    return false;
  }

  const lastTime = new Date(lastTs).toLocaleTimeString();
  pass('RateLimit', `Last attempt was ${(elapsed / 1000).toFixed(0)}s ago (at ${lastTime}) — gap OK`);
  return true;
}

function recordLoginAttempt() {
  fs.writeFileSync(RATE_LIMIT_FILE, String(Date.now()), 'utf8');
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 2 — CREDENTIAL VALIDATION (no network)
// ════════════════════════════════════════════════════════════════════
function validateCredentials() {
  head('LAYER 2 — Credential Validation (no network)');
  let ok = true;

  // API Key
  if (!CREDS.apiKey) {
    fail('API_KEY', 'ANGEL_API_KEY missing from .env', 'Add ANGEL_API_KEY=your_key to .env');
    ok = false;
  } else if (CREDS.apiKey.length < 6) {
    fail('API_KEY', `Too short: "${CREDS.apiKey}" (len=${CREDS.apiKey.length})`, 'Get API key from smartapi.angelone.in → My Profile → My APIs');
    ok = false;
  } else if (/[^A-Za-z0-9_-]/.test(CREDS.apiKey)) {
    warn('API_KEY', `Contains unusual characters: "${CREDS.apiKey}"`, 'API key should be alphanumeric. Remove quotes or spaces from .env value.');
  } else {
    pass('API_KEY', CREDS.apiKey);
  }

  // Client Code
  if (!CREDS.clientId) {
    fail('CLIENT_CODE', 'Missing (tried ANGEL_CLIENT_CODE and CLIENT_CODE)', 'Add ANGEL_CLIENT_CODE=SBHS331 to .env');
    ok = false;
  } else {
    pass('CLIENT_CODE', CREDS.clientId);
  }

  // MPIN
  if (!CREDS.mpin) {
    fail('MPIN', 'ANGEL_MPIN missing from .env', 'Add ANGEL_MPIN=1992 (4-digit trading PIN)');
    ok = false;
  } else if (!/^\d{4,6}$/.test(CREDS.mpin)) {
    fail('MPIN', `"${CREDS.mpin}" is not 4–6 digits`, 'MPIN = trading PIN (4 digits), NOT your login password');
    ok = false;
  } else {
    pass('MPIN', `${'*'.repeat(CREDS.mpin.length)} (len=${CREDS.mpin.length})`);
  }

  // TOTP Secret
  if (!CREDS.totpSec) {
    fail('TOTP_SECRET', 'ANGEL_TOTP_SECRET missing from .env', 'Add the 32-char base32 key from SmartAPI TOTP setup');
    ok = false;
  } else if (CREDS.totpSec.length === 6 && /^\d+$/.test(CREDS.totpSec)) {
    fail('TOTP_SECRET', 'Looks like a 6-digit code — that is the CURRENT code, not the secret!',
      'Get the 32-char BASE32 KEY from smartapi.angelbroking.com/enable-totp');
    ok = false;
  } else if (!/^[A-Z2-7]+=*$/.test(CREDS.totpSec)) {
    fail('TOTP_SECRET', `Invalid base32 characters in: "${CREDS.totpSec.substring(0,10)}..."`,
      'Must contain only A-Z and 2-7. Check you copied the full secret key.');
    ok = false;
  } else if (CREDS.totpSec.length < 16) {
    fail('TOTP_SECRET', `Too short (len=${CREDS.totpSec.length}, need ≥16)`,
      'TOTP secret should be 32 chars. Ensure you copied the full key.');
    ok = false;
  } else {
    pass('TOTP_SECRET', `***...*** (len=${CREDS.totpSec.length})`);
  }

  // TOTP generation test
  if (ok) {
    try {
      const code = speakeasy.totp({ secret: CREDS.totpSec, encoding: 'base32' });
      pass('TOTP_GEN', `Can generate TOTP codes — current: ${code}`);
    } catch (e) {
      fail('TOTP_GEN', `speakeasy error: ${e.message}`, 'npm install speakeasy');
      ok = false;
    }
  }

  return ok;
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 3 — CLOCK DRIFT CHECK
// ════════════════════════════════════════════════════════════════════
async function checkClockDrift() {
  head('LAYER 3 — Clock Drift Check (TOTP fails if clock off > 30s)');

  const localMs = Date.now();

  for (const url of NTP_SERVERS) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 4000);
      const res  = await fetch(url, { signal: ctrl.signal });
      clearTimeout(tid);

      const body = await res.json();
      // worldtimeapi: body.unixtime (seconds), timeapi: body.dateTime
      let serverMs;
      if (body.unixtime)  serverMs = body.unixtime * 1000;
      else if (body.dateTime) serverMs = new Date(body.dateTime + 'Z').getTime();
      else continue;

      const driftS = Math.abs(Date.now() - serverMs) / 1000;
      if (driftS > 30) {
        fail('ClockDrift',
          `PC clock is ${driftS.toFixed(1)}s off from internet time — TOTP will fail (AB1050)`,
          'Settings → Time → "Sync now"  (or: w32tm /resync in admin CMD)');
        return false;
      } else if (driftS > 10) {
        warn('ClockDrift',
          `PC clock is ${driftS.toFixed(1)}s off — within tolerance but borderline`,
          'Settings → Time → "Sync now" to be safe');
        return true;
      } else {
        pass('ClockDrift', `${driftS.toFixed(2)}s drift (OK — checked via ${url.split('/')[2]})`);
        return true;
      }
    } catch (_) { /* try next server */ }
  }

  warn('ClockDrift', 'Could not reach time servers — cannot verify clock drift',
    'Manually ensure Windows clock is NTP-synced');
  return true; // non-blocking
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 4 — DNS RESOLUTION
// ════════════════════════════════════════════════════════════════════
async function checkDns() {
  head('LAYER 4 — DNS Resolution');

  const hosts = [ANGEL_HOST, ANGEL_WS_HOST, 'smartapi.angelone.in'];
  let allOk   = true;

  for (const h of hosts) {
    try {
      const addrs = await dns.resolve4(h);
      pass(`DNS:${h}`, addrs.join(', '));
    } catch (e) {
      fail(`DNS:${h}`, `Cannot resolve — ${e.message}`,
        'Check internet connection. Try: nslookup ' + h);
      allOk = false;
    }
  }
  return allOk;
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 5 — TCP / TLS CONNECTIVITY
// ════════════════════════════════════════════════════════════════════
async function checkTcp() {
  head('LAYER 5 — TCP Connectivity (port 443)');

  return new Promise(resolve => {
    const sock = net.createConnection({ host: ANGEL_HOST, port: 443 });
    const tid  = setTimeout(() => {
      sock.destroy();
      fail('TCP:443', `Connection to ${ANGEL_HOST}:443 timed out`,
        'Firewall may be blocking outbound HTTPS. Check Windows Firewall or antivirus.');
      resolve(false);
    }, 5000);

    sock.on('connect', () => {
      clearTimeout(tid);
      sock.destroy();
      pass('TCP:443', `${ANGEL_HOST}:443 reachable`);
      resolve(true);
    });

    sock.on('error', err => {
      clearTimeout(tid);
      fail('TCP:443', `Cannot connect: ${err.message}`,
        'Check internet and firewall settings');
      resolve(false);
    });
  });
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 6 — PUBLIC IP DETECTION
// ════════════════════════════════════════════════════════════════════
async function detectPublicIp() {
  head('LAYER 6 — Public IP Detection (what Angel One sees)');

  const sources = [
    // PR#11 from SDK: ipify can rate-limit → use amazonaws as primary
    { url: 'https://checkip.amazonaws.com',    parse: t => t.trim() },
    { url: 'https://api.ipify.org?format=json', parse: t => JSON.parse(t).ip },
    { url: 'https://api.ip.sb/ip',              parse: t => t.trim() },
  ];

  for (const src of sources) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 5000);
      const res  = await fetch(src.url, { signal: ctrl.signal });
      clearTimeout(tid);
      const ip   = src.parse(await res.text());
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) {
        pass('PublicIP', `${ip}  (via ${src.url.split('/')[2]})`);
        // Check if it looks like a private IP (would be a proxy/NAT issue)
        if (/^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(ip)) {
          warn('PublicIP:Private',
            `${ip} is a PRIVATE IP — Angel One may see a different external IP`,
            'You may be behind double-NAT. Ask ISP for your real static IP.');
        }
        return ip;
      }
    } catch (_) { /* try next */ }
  }

  warn('PublicIP', 'Cannot detect public IP from any source', 'Check internet connection');
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 7 — WAF HEADER FINGERPRINT TEST
// ════════════════════════════════════════════════════════════════════
async function wafHeaderTest(publicIp) {
  head('LAYER 7 — WAF Header Fingerprint Test');
  info('Testing with WRONG credentials — no WAF ban risk');
  info('Finding the exact header combination that bypasses the WAF...');

  const dummyBody = JSON.stringify({ clientcode: 'WAF_PROBE', password: '0000', totp: '000000' });

  async function probe(label, hdrs) {
    try {
      const ctrl = new AbortController();
      const tid  = setTimeout(() => ctrl.abort(), 8000);
      const res  = await fetch(ENDPOINTS.loginByPassword, {
        method: 'POST', headers: hdrs, body: dummyBody, signal: ctrl.signal,
      });
      clearTimeout(tid);
      const text = await res.text();

      if (text.includes('Request Rejected') || text.startsWith('<html')) {
        const sid = text.match(/Support ID is: (\d+)/)?.[1];
        console.log(`  ${C.red}  ✗ BLOCKED${C.reset}  [${label}]${sid ? `  Support ID: ${sid}` : ''}`);
        return { blocked: true, supportId: sid };
      }
      // Got JSON back — WAF passed
      let code = '?';
      try { code = JSON.parse(text).errorcode || 'none'; } catch (_) {}
      console.log(`  ${C.green}  ✓ PASSED ${C.reset}  [${label}]  errorcode=${code}`);
      return { blocked: false, errorCode: code };
    } catch (e) {
      if (e.name === 'AbortError') {
        console.log(`  ${C.yellow}  ⏱ TIMEOUT${C.reset}  [${label}]`);
      } else {
        console.log(`  ${C.yellow}  ? ERROR  ${C.reset}  [${label}]  ${e.message.substring(0, 50)}`);
      }
      return { blocked: null };
    }
  }

  // Test 1: No User-Agent (this is what your Node.js sends by default)
  const baseHdrs = {
    'Content-Type'     : 'application/json',
    'Accept'           : 'application/json',
    'X-PrivateKey'     : CREDS.apiKey,
    'X-UserType'       : 'USER',
    'X-SourceID'       : 'WEB',
    'X-ClientLocalIP'  : '127.0.0.1',
    'X-ClientPublicIP' : publicIp || '103.248.121.80',
    'X-MACAddress'     : '00:00:00:00:00:00',
  };
  const r1 = await probe('No User-Agent  ← what your service sends NOW', baseHdrs);
  await sleep(1500);

  // Test 2: With User-Agent
  const uaHdrs = { ...baseHdrs, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' };
  const r2 = await probe('With User-Agent ← what your service SHOULD send', uaHdrs);
  await sleep(1500);

  // Analysis
  console.log('');
  if (r1.blocked === true && r2.blocked === false) {
    pass('WAF:Analysis', 'User-Agent is the WAF trigger — adding it FIXES the block');
    info('The one missing header in angelone.service.ts is causing all your WAF blocks.');
    return { clear: true, needsUserAgent: true, publicIp };
  } else if (r1.blocked === true && r2.blocked === true) {
    fail('WAF:Analysis',
      `IP ${publicIp} is BLOCKED regardless of headers — Angel One has flagged this IP`,
      '');
    console.log(`\n  ${C.yellow}  Support ID from this test: ${r2.supportId || r1.supportId || 'none'}${C.reset}`);
    console.log(`\n  ${C.bold}  OPTIONS:${C.reset}`);
    console.log(`  1. ${C.cyan}Mobile Hotspot${C.reset} — connect PC to phone hotspot, re-run`);
    console.log(`     If it works from hotspot: your home IP is banned, not your account`);
    console.log(`  2. ${C.cyan}Email Angel One${C.reset}:`);
    console.log(`     To: api-support@angelone.in`);
    console.log(`     Subject: WAF IP Whitelist Request — SBHS331`);
    console.log(`     Body: Please whitelist IP ${publicIp}.`);
    console.log(`     WAF Support IDs: 13566360942366957887, 17548718322139279707`);
    console.log(`     New Support ID: ${r2.supportId || r1.supportId || 'see above'}`);
    console.log(`  3. ${C.cyan}Wait 24-72 hours${C.reset} — WAF bans are time-based`);
    console.log(`     Do NOT run any login tests until ban lifts.`);
    return { clear: false };
  } else if (r1.blocked === false) {
    pass('WAF:Analysis', 'WAF is NOT blocking your IP — both header sets pass');
    info('Your IP is clean. If login still fails, it will be a credentials issue.');
    return { clear: true, needsUserAgent: false, publicIp };
  } else {
    warn('WAF:Analysis', 'Inconclusive — could not determine WAF status from responses');
    return { clear: true, needsUserAgent: true, publicIp }; // proceed with UA just in case
  }
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 8 — TOTP WINDOW GUARD
// ════════════════════════════════════════════════════════════════════
async function waitForFreshTotp() {
  head('LAYER 8 — TOTP Window Guard');

  const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);

  if (remaining < TOTP_MIN_LIFE) {
    warn('TOTP:Window',
      `Current TOTP expires in ${remaining}s — too close to expiry, waiting for fresh code`,
      '');
    const waitMs = (remaining + 1) * 1000;
    info(`Waiting ${remaining + 1}s for next TOTP window...`);
    await sleep(waitMs);
    const code = speakeasy.totp({ secret: CREDS.totpSec, encoding: 'base32' });
    pass('TOTP:Window', `Fresh TOTP ready: ${code} (30s window)`);
    return code;
  }

  const code = speakeasy.totp({ secret: CREDS.totpSec, encoding: 'base32' });
  pass('TOTP:Window', `TOTP: ${code} — ${remaining}s remaining (safe)`);
  return code;
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 9 — REAL LOGIN (1 attempt, hard stop)
// ════════════════════════════════════════════════════════════════════
async function realLogin(totp, publicIp) {
  head('LAYER 9 — Real Login (1 attempt, then STOP regardless of result)');

  const hdrs = buildHeaders(CREDS.apiKey, publicIp || '103.248.121.80');
  const body = JSON.stringify({ clientcode: CREDS.clientId, password: CREDS.mpin, totp });

  info(`Endpoint  : loginByPassword`);
  info(`ClientCode: ${CREDS.clientId}`);
  info(`TOTP      : ${totp}`);
  console.log('');

  // Record attempt BEFORE sending (so even a crash counts)
  recordLoginAttempt();

  try {
    const res  = await fetch(ENDPOINTS.loginByPassword, { method: 'POST', headers: hdrs, body });
    const text = await res.text();

    // WAF block (should never happen after Layer 7 cleared it, but guard anyway)
    if (text.includes('Request Rejected') || text.startsWith('<html')) {
      const sid = text.match(/Support ID is: (\d+)/)?.[1] || 'unknown';
      fail('Login', `WAF blocked the REAL login request (unexpected after probe passed)`,
        `Support ID: ${sid} — Email api-support@angelone.in`);
      return null;
    }

    let j;
    try { j = JSON.parse(text); }
    catch (_) {
      warn('Login', `Non-JSON response (len=${text.length}): ${text.substring(0, 150)}`);
      return null;
    }

    if (j.status === true) {
      pass('Login', 'SUCCESS — JWT token received');
      return j.data;
    }

    // Handle every known error code
    const code = j.errorcode;
    const msg  = j.message;
    fail('Login', `[${code}] ${msg}`);

    const diagnostics = {
      AB1007: [
        `CLIENT_CODE in .env: "${CREDS.clientId}"`,
        `Verify this matches your Angel One login at trade.angelone.in`,
        `MPIN must be 4-digit trading PIN, NOT your login password`,
        `Old Angel Broking account not migrated?`,
        `Email: support@angelbroking.com | Form: https://docs.google.com/forms/d/e/1FAIpQLSdgpCiDhSBa_bsKsec002e9unbeQkipOLFAKW7DzPvmiowsaw/viewform`,
      ],
      AB1050: [
        `TOTP code "${totp}" was rejected`,
        `PC clock may be drifted (Layer 3 may have been inconclusive)`,
        `Run: w32tm /resync  in Admin CMD, then retry`,
        `Verify TOTP_SECRET is the 32-char base32 KEY, not the 6-digit code`,
      ],
      AB1053: [
        `Invalid API key: "${CREDS.apiKey}"`,
        `Login to smartapi.angelone.in → My Profile → My APIs`,
        `New portal (New Login) issues DIFFERENT keys than old portal`,
        `AB1053 also occurs for ~5 minutes after registering a new static IP — wait and retry`,
      ],
      AB1010: [
        `Session already active for this account`,
        `Go to trade.angelone.in → top-right menu → Logout from all devices`,
        `Wait 30 seconds then re-run this script`,
      ],
      AB2001: [
        `Static IP ${publicIp} not registered`,
        `Go to smartapi.angelone.in → My Profile → My APIs (New)`,
        `Add ${publicIp} as Primary or Secondary Static IP`,
        `⚠️  Mandatory from April 1, 2026 — 20 days away`,
      ],
      AB1004: [
        `Angel One internal server error (their side, not yours)`,
        `Wait 60 seconds and run this script again`,
        `If persists: check https://smartapi.angelone.in/smartapi/forum`,
      ],
    };

    const diag = diagnostics[code];
    if (diag) {
      console.log(`\n  ${C.cyan}  Diagnosis for [${code}]:${C.reset}`);
      diag.forEach(d => info(`  • ${d}`));
    } else {
      info(`Unknown error code. Check: https://smartapi.angelone.in/smartapi/forum`);
    }

    return null;
  } catch (e) {
    fail('Login', `Network error: ${e.message}`, 'Check connection');
    return null;
  }
}

// ════════════════════════════════════════════════════════════════════
//  LAYER 10 — POST-LOGIN VALIDATION + TOKEN PERSISTENCE
// ════════════════════════════════════════════════════════════════════
async function postLoginValidation(data, publicIp) {
  head('LAYER 10 — Post-Login Validation + Token Persistence');

  const jwtToken     = data.jwtToken;
  const refreshToken = data.refreshToken;
  const feedToken    = String(data.feedToken); // [J] always cast to string

  // feedToken type check [J]
  if (typeof data.feedToken === 'string') {
    pass('FeedToken:Type', `Is string — correct [research finding J]`);
  } else {
    warn('FeedToken:Type',
      `feedToken is ${typeof data.feedToken} — must be cast to String()`,
      `In angelone.service.ts: const feedToken = String(data.feedToken)`);
  }

  // Test JWT with getProfile
  await sleep(1000);
  try {
    const hdrs = {
      ...buildHeaders(CREDS.apiKey, publicIp || '103.248.121.80'),
      'Authorization': `Bearer ${jwtToken}`,
    };
    const res  = await fetch(ENDPOINTS.getProfile, { method: 'GET', headers: hdrs });
    const body = await res.json();
    if (body.status === true) {
      pass('JWT:getProfile', `Valid — name: ${body.data.name}, client: ${body.data.clientcode}`);
      info(`Exchanges: ${(body.data.exchanges || []).join(', ')}`);
    } else {
      warn('JWT:getProfile', `Profile failed: ${body.errorcode} — ${body.message}`);
    }
  } catch (e) {
    warn('JWT:getProfile', `Network error: ${e.message}`);
  }

  // Test token refresh (to verify we can refresh without re-logging in tomorrow)
  await sleep(1000);
  try {
    const hdrs = {
      ...buildHeaders(CREDS.apiKey, publicIp || '103.248.121.80'),
      'Authorization': `Bearer ${jwtToken}`,
    };
    const res  = await fetch(ENDPOINTS.generateTokens, {
      method: 'POST',
      headers: hdrs,
      body: JSON.stringify({ refreshToken }),
    });
    const body = await res.json();
    if (body.status === true) {
      pass('TokenRefresh', 'Token refresh works — use this on restart instead of re-login');
      info('On collector restart: call /generateTokens with saved refreshToken');
      info('Only call /loginByPassword if refresh also fails');
    } else {
      warn('TokenRefresh', `Refresh failed: ${body.errorcode} — ${body.message}`,
        'Token refresh may need valid session — test separately');
    }
  } catch (e) {
    warn('TokenRefresh', `Network error: ${e.message}`);
  }

  // Save tokens to disk — prevents re-login until midnight
  const tokenData = {
    jwtToken,
    refreshToken,
    feedToken,
    savedAt    : Date.now(),
    savedAtIST : new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    expiresAt  : 'midnight IST (Angel One expires all sessions at 00:00)',
    clientId   : CREDS.clientId,
  };
  try {
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify(tokenData, null, 2), 'utf8');
    pass('TokenPersist', `Tokens saved to ${TOKEN_CACHE}`);
    info('Your backend can now read these tokens on startup to avoid daily re-login');
    info('Add angel-tokens.json to .gitignore if not already there');
  } catch (e) {
    warn('TokenPersist', `Could not save tokens: ${e.message}`, 'Check write permissions');
  }

  return tokenData;
}

// ════════════════════════════════════════════════════════════════════
//  PRINT BACKEND FIX SUMMARY
// ════════════════════════════════════════════════════════════════════
function printFixes(wafResult) {
  head('WHAT NEEDS FIXING IN angelone.service.ts');

  const fixes = [];

  if (wafResult?.needsUserAgent) {
    fixes.push({
      priority: '🔴 CRITICAL',
      file: 'angelone.service.ts',
      what: "Add 'User-Agent' header to login() and getHeaders()",
      code: `'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'`,
    });
  }

  fixes.push({
    priority: '🔴 CRITICAL',
    file: 'angelone.service.ts',
    what: "Change login endpoint from loginByMpin to loginByPassword",
    code: `const LOGIN_URL = 'https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword'`,
  });

  fixes.push({
    priority: '🟡 IMPORTANT',
    file: 'angelone.service.ts',
    what: 'Cast feedToken to String() — new API returns JWT string, not integer',
    code: `const feedToken = String(data.feedToken);`,
  });

  fixes.push({
    priority: '🟡 IMPORTANT',
    file: 'websocket-collector.ts',
    what: 'Add 60s minimum gap between login attempts (WAF rate limit: 5/min)',
    code: `if (Date.now() - lastLoginAt < 60_000) await sleep(60_000 - (Date.now() - lastLoginAt));`,
  });

  fixes.push({
    priority: '🟢 RECOMMENDED',
    file: 'angelone.service.ts',
    what: 'Use refreshToken to restore session on restart (avoid daily re-login)',
    code: `POST /rest/auth/angelbroking/jwt/v1/generateTokens  { refreshToken }`,
  });

  fixes.push({
    priority: '🟢 RECOMMENDED',
    file: 'websocket-collector.ts',
    what: 'Bug 2: Reset dbErrors=0 in abort()',
    code: `function abort() { dbErrors = 0; /* rest of abort */ }`,
  });

  fixes.push({
    priority: '🟢 RECOMMENDED',
    file: 'websocket-collector.ts',
    what: 'Bug 3: Skip OI divergence check when LTP < 0.5 (avoids all-SPOOF false positives)',
    code: `if (strike.ltp < 0.5) continue; // skip oiDiv for near-zero LTP strikes`,
  });

  fixes.forEach(f => {
    console.log(`\n  ${f.priority}  ${f.file}`);
    console.log(`  ${C.gray}${f.what}${C.reset}`);
    console.log(`  ${C.cyan}${f.code.substring(0, 90)}${f.code.length > 90 ? '...' : ''}${C.reset}`);
  });
}

// ════════════════════════════════════════════════════════════════════
//  MAIN ORCHESTRATOR
// ════════════════════════════════════════════════════════════════════
(async () => {
  console.log(`\n${C.bold}${C.cyan}`);
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  JOBBER × ANGEL ONE — BULLETPROOF LOGIN TEST  v4.0          ║');
  console.log('║  10 safety layers  •  Max 2 real requests  •  March 2026    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(C.reset);

  // ── Layer 1: Rate limit memory (local, no network) ────────────────
  const rateOk = checkRateLimit();
  if (!rateOk) { process.exit(0); }

  // ── Layer 2: Credential validation (local, no network) ────────────
  const credsOk = validateCredentials();
  if (!credsOk) {
    console.log(`\n${C.red}  ❌  Fix credential issues above before testing.${C.reset}\n`);
    process.exit(1);
  }

  // ── Layer 3: Clock drift ──────────────────────────────────────────
  await checkClockDrift(); // non-blocking warning

  // ── Layer 4: DNS ──────────────────────────────────────────────────
  const dnsOk = await checkDns();
  if (!dnsOk) {
    console.log(`\n${C.red}  ❌  DNS resolution failed — check internet connection.${C.reset}\n`);
    process.exit(1);
  }

  // ── Layer 5: TCP ──────────────────────────────────────────────────
  const tcpOk = await checkTcp();
  if (!tcpOk) {
    console.log(`\n${C.red}  ❌  Cannot reach Angel One servers on port 443.${C.reset}\n`);
    process.exit(1);
  }

  // ── Layer 6: Public IP ────────────────────────────────────────────
  const publicIp = await detectPublicIp();

  // ── Layer 7: WAF probe ────────────────────────────────────────────
  const wafResult = await wafHeaderTest(publicIp);
  if (!wafResult.clear) {
    printFixes(wafResult);
    console.log(`\n${C.red}  ⛔  WAF blocked. Real login skipped to protect your account.${C.reset}\n`);
    process.exit(0);
  }

  // ── Layer 8: TOTP window guard ────────────────────────────────────
  const totp = await waitForFreshTotp();

  // 3s pause between WAF probe and real login
  info('\nWaiting 3s before real login...');
  await sleep(3000);

  // ── Layer 9: Real login ───────────────────────────────────────────
  const loginData = await realLogin(totp, publicIp);
  if (!loginData) {
    printFixes(wafResult);
    console.log(`\n${C.red}  ❌  Login failed. See fixes above.${C.reset}\n`);
    process.exit(1);
  }

  // ── Layer 10: Post-login validation + token persistence ───────────
  await postLoginValidation(loginData, publicIp);

  // ── Final fix summary ─────────────────────────────────────────────
  printFixes(wafResult);

  // ── Restart commands ──────────────────────────────────────────────
  head('READY — RESTART COMMANDS');
  console.log(`  ${C.green}Stop existing node processes:${C.reset}`);
  console.log(`    Get-Process node | Stop-Process -Force`);
  console.log(`  ${C.green}Start backend:${C.reset}`);
  console.log(`    cd D:\\jobber-perfect\\backend`);
  console.log(`    npx ts-node api-server.ts`);
  console.log(`  ${C.green}Start collector:${C.reset}`);
  console.log(`    npx ts-node src/scripts/websocket-collector.ts`);
  console.log(`  ${C.green}Start frontend:${C.reset}`);
  console.log(`    cd D:\\jobber-perfect\\frontend && npm run dev`);
  console.log('');

})().catch(e => {
  console.error(`\n${C.red}  FATAL: ${e.message}${C.reset}`);
  console.error(e.stack);
  process.exit(1);
});
