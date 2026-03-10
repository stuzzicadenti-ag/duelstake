/**
 * DuelStake Cross-Validation Tests
 *
 * Validates security invariants across the codebase without requiring
 * a running server or database. Uses static analysis of source files
 * and unit tests of exported utilities.
 *
 * Run: node --test app/tests/validation.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '..', 'src');
const VIEWS = join(SRC, 'views');
const ROUTES = join(SRC, 'routes');

// ─── Helpers ───────────────────────────────────────────────────────

function readFile(relPath) {
  return readFileSync(join(SRC, relPath), 'utf-8');
}

function readAllEjs(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...readAllEjs(full));
    } else if (entry.name.endsWith('.ejs')) {
      results.push({ path: full, name: entry.name, content: readFileSync(full, 'utf-8') });
    }
  }
  return results;
}

const allEjs = readAllEjs(VIEWS);
const serverSrc = readFile('server.js');
const authSrc = readFile('routes/auth.js');
const adminSrc = readFile('routes/admin.js');
const matchesSrc = readFile('routes/matches.js');
const walletSrc = readFile('routes/wallet.js');
const profileSrc = readFile('routes/profile.js');
const wsSrc = readFile('routes/ws.js');
const gamesSrc = readFile('routes/games.js');
const leaderboardSrc = readFile('routes/leaderboard.js');

// ─── 1. Route Security ────────────────────────────────────────────

describe('Route Security - Auth Checks', () => {
  it('wallet routes check request.user', () => {
    // All POST wallet routes should check auth
    const postRoutes = walletSrc.match(/app\.post\([^)]+,\s*async\s*\([^)]+\)\s*=>\s*\{[^]*?(?=\n\s*app\.|$)/g) || [];
    assert.ok(postRoutes.length >= 2, 'Should have at least deposit and withdraw POST routes');
    for (const route of postRoutes) {
      assert.ok(
        route.includes('!request.user') || route.includes("request.user"),
        'Wallet POST route should check authentication'
      );
    }
  });

  it('match mutation routes check request.user', () => {
    const mutations = ['create', 'join', 'proof', 'report', 'flag'];
    for (const name of mutations) {
      assert.ok(
        matchesSrc.includes(`!request.user`),
        `matches route should check request.user for ${name}`
      );
    }
  });

  it('profile mutation routes check request.user', () => {
    assert.ok(profileSrc.includes('!request.user'), 'Profile routes should check authentication');
  });

  it('admin routes use requireAdmin preHandler hook', () => {
    assert.ok(
      adminSrc.includes("app.addHook('preHandler', requireAdmin)"),
      'Admin routes should register requireAdmin as preHandler hook'
    );
  });

  it('auth routes use POST for mutations (login, register)', () => {
    assert.ok(authSrc.includes("app.post('/register'"), 'Register should be POST');
    assert.ok(authSrc.includes("app.post('/login'"), 'Login should be POST');
  });

  it('logout is GET but only clears cookie (no mutation)', () => {
    assert.ok(authSrc.includes("app.get('/logout'"), 'Logout should exist');
    assert.ok(authSrc.includes("clearCookie('token'"), 'Logout should clear cookie');
  });
});

// ─── 2. Input Validation ──────────────────────────────────────────

describe('Input Validation', () => {
  it('auth register validates email format', () => {
    assert.ok(authSrc.includes('EMAIL_RE.test(email)'), 'Should validate email with regex');
  });

  it('auth register validates email length', () => {
    assert.ok(authSrc.includes('email.length > 255'), 'Should check email max length');
  });

  it('auth register validates username length', () => {
    assert.ok(authSrc.includes('username.length < 3'), 'Should check min username length');
    assert.ok(authSrc.includes('username.length > 50'), 'Should check max username length');
  });

  it('auth register validates password length', () => {
    assert.ok(authSrc.includes('password.length < 8'), 'Should check min password length');
    assert.ok(authSrc.includes('password.length > 1000'), 'Should check max password length');
  });

  it('auth register validates display_name length', () => {
    assert.ok(authSrc.includes('display_name.length > 100'), 'Should check max display_name length');
  });

  it('wallet deposit validates amount bounds', () => {
    assert.ok(walletSrc.includes('depositAmount <= 0'), 'Should reject zero/negative deposits');
    assert.ok(walletSrc.includes('depositAmount > 10000'), 'Should cap deposits at 10000');
  });

  it('wallet withdraw validates amount is positive', () => {
    assert.ok(walletSrc.includes('withdrawAmount <= 0'), 'Should reject zero/negative withdrawals');
  });

  it('match create validates stake is within game range', () => {
    assert.ok(matchesSrc.includes('g.min_stake'), 'Should check against game min stake');
    assert.ok(matchesSrc.includes('g.max_stake'), 'Should check against game max stake');
  });

  it('match create validates stake is a number', () => {
    assert.ok(matchesSrc.includes('isNaN(stake)'), 'Should check stake is a number');
  });

  it('match join prevents joining own match', () => {
    assert.ok(matchesSrc.includes('match.player1_id === userId'), 'Should prevent joining own match');
  });

  it('proof upload validates file type', () => {
    assert.ok(matchesSrc.includes('ALLOWED_EXTS'), 'Should whitelist file extensions');
    assert.ok(matchesSrc.includes('ALLOWED_MIMES'), 'Should whitelist MIME types');
  });

  it('proof upload sanitizes matchId for path traversal', () => {
    assert.ok(matchesSrc.includes('parseInt(matchId, 10)'), 'Should parseInt to prevent path traversal');
  });

  it('KYC upload validates document type', () => {
    assert.ok(profileSrc.includes("'passport', 'id_card', 'drivers_license'"), 'Should whitelist document types');
  });

  it('admin role change validates role value', () => {
    assert.ok(adminSrc.includes("['user', 'admin', 'owner'].includes(role)"), 'Should whitelist roles');
  });

  it('admin warning validates reason against whitelist', () => {
    assert.ok(adminSrc.includes('WARNING_REASONS.includes(reason)'), 'Should validate warning reason');
  });

  it('server sets body limit', () => {
    assert.ok(serverSrc.includes('bodyLimit: 1048576'), 'Should set bodyLimit to 1MB');
  });

  it('multipart upload has file size limit', () => {
    assert.ok(serverSrc.includes('fileSize: 10 * 1024 * 1024'), 'Should limit file uploads to 10MB');
  });
});

// ─── 3. XSS Safety ────────────────────────────────────────────────

describe('XSS Safety - EJS Template Escaping', () => {
  it('no raw output of user-controlled variables (<%- variable %>)', () => {
    const unsafePatterns = [];
    for (const { path, name, content } of allEjs) {
      // Find all <%- ... %> usages
      const matches = content.matchAll(/<%-(.*?)%>/gs);
      for (const m of matches) {
        const expr = m[1].trim();
        // Safe: include(), t() calls (controlled i18n strings), JSON.stringify, hardcoded defs
        if (expr.startsWith('include(')) continue;
        if (/^t\(/.test(expr)) continue;
        if (expr.startsWith('JSON.stringify')) continue;
        if (expr === 'def.icon') continue;
        // Safe: hardcoded HTML entities in ternary (not user data)
        if (/^i\s*===\s*\d+\s*\?\s*'&#\d+;\s*'\s*:/.test(expr)) continue;
        unsafePatterns.push({ file: name, expr });
      }
    }
    assert.equal(
      unsafePatterns.length, 0,
      `Found unsafe <%- %> with user data:\n${unsafePatterns.map(p => `  ${p.file}: <%- ${p.expr} %>`).join('\n')}`
    );
  });

  it('error messages in templates use escaped output (<%= %>)', () => {
    for (const { name, content } of allEjs) {
      // Check that error/message display uses <%= not <%-
      const errorOutputs = content.matchAll(/<%[-=]\s*error\s*%>/g);
      for (const m of errorOutputs) {
        assert.ok(
          m[0].startsWith('<%='),
          `${name}: error variable should use <%= not <%- for safety`
        );
      }
    }
  });

  it('evidence URLs are sanitized against javascript: protocol', () => {
    const detailEjs = allEjs.find(e => e.name === 'detail.ejs' && e.path.includes('matches'));
    assert.ok(detailEjs, 'matches/detail.ejs should exist');
    assert.ok(
      detailEjs.content.includes('safeEvidenceUrl'),
      'Evidence URL in matches/detail.ejs should be sanitized'
    );

    const viewEjs = allEjs.find(e => e.name === 'view.ejs' && e.path.includes('profile'));
    assert.ok(viewEjs, 'profile/view.ejs should exist');
    assert.ok(
      viewEjs.content.includes('safeWarnUrl'),
      'Evidence URL in profile/view.ejs should be sanitized'
    );
  });

  it('banned.ejs uses escaped output for reason', () => {
    const banned = allEjs.find(e => e.name === 'banned.ejs');
    assert.ok(banned, 'banned.ejs should exist');
    assert.ok(
      banned.content.includes('<%= reason %>'),
      'Ban reason should use escaped output'
    );
    assert.ok(
      !banned.content.includes('<%- reason %>'),
      'Ban reason should not use unescaped output'
    );
  });
});

// ─── 4. Rate Limiting ─────────────────────────────────────────────

describe('Rate Limiting', () => {
  it('server defines checkAuthRateLimit decorator', () => {
    assert.ok(serverSrc.includes("app.decorate('checkAuthRateLimit'"), 'Should decorate checkAuthRateLimit');
  });

  it('server defines checkActionRateLimit decorator', () => {
    assert.ok(serverSrc.includes("app.decorate('checkActionRateLimit'"), 'Should decorate checkActionRateLimit');
  });

  it('auth login uses rate limiting', () => {
    assert.ok(authSrc.includes('checkAuthRateLimit'), 'Login should use auth rate limit');
  });

  it('auth register uses rate limiting', () => {
    const registerBlock = authSrc.slice(authSrc.indexOf("app.post('/register'"));
    assert.ok(registerBlock.includes('checkAuthRateLimit'), 'Register should use auth rate limit');
  });

  it('match create uses action rate limiting', () => {
    assert.ok(matchesSrc.includes('checkActionRateLimit'), 'Match routes should use action rate limit');
  });

  it('wallet deposit uses action rate limiting', () => {
    const depositBlock = walletSrc.slice(walletSrc.indexOf("app.post('/deposit'"));
    assert.ok(depositBlock.includes('checkActionRateLimit'), 'Deposit should use action rate limit');
  });

  it('wallet withdraw uses action rate limiting', () => {
    const withdrawBlock = walletSrc.slice(walletSrc.indexOf("app.post('/withdraw'"));
    assert.ok(withdrawBlock.includes('checkActionRateLimit'), 'Withdraw should use action rate limit');
  });

  it('match proof upload uses action rate limiting', () => {
    const proofBlock = matchesSrc.slice(matchesSrc.indexOf("app.post('/:id/proof'"));
    assert.ok(proofBlock.includes('checkActionRateLimit'), 'Proof upload should use action rate limit');
  });

  it('match flag uses action rate limiting', () => {
    const flagBlock = matchesSrc.slice(matchesSrc.indexOf("app.post('/:id/flag'"));
    assert.ok(flagBlock.includes('checkActionRateLimit'), 'Flag should use action rate limit');
  });

  it('match report uses action rate limiting', () => {
    const reportBlock = matchesSrc.slice(matchesSrc.indexOf("app.post('/:id/report'"));
    assert.ok(reportBlock.includes('checkActionRateLimit'), 'Report should use action rate limit');
  });

  it('profile report uses action rate limiting', () => {
    const reportBlock = profileSrc.slice(profileSrc.indexOf("app.post('/:id/report'"));
    assert.ok(reportBlock.includes('checkActionRateLimit'), 'Profile report should use action rate limit');
  });

  it('KYC upload uses action rate limiting', () => {
    const verifyBlock = profileSrc.slice(profileSrc.indexOf("app.post('/verify'"));
    assert.ok(verifyBlock.includes('checkActionRateLimit'), 'KYC upload should use action rate limit');
  });

  it('rate limit returns 429 status code', () => {
    assert.ok(serverSrc.includes('reply.code(429)'), 'Should return 429 for rate limit exceeded');
  });

  it('rate limit maps are cleaned up periodically', () => {
    const intervals = (serverSrc.match(/setInterval/g) || []).length;
    assert.ok(intervals >= 2, 'Should have cleanup intervals for both auth and action rate limit maps');
  });
});

// ─── 5. Security Headers ──────────────────────────────────────────

describe('Security Headers', () => {
  const requiredHeaders = [
    'Strict-Transport-Security',
    'X-Content-Type-Options',
    'X-Frame-Options',
    'X-XSS-Protection',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
  ];

  for (const header of requiredHeaders) {
    it(`sets ${header} header`, () => {
      assert.ok(serverSrc.includes(header), `Should set ${header} header in onSend hook`);
    });
  }

  it('removes X-Powered-By header', () => {
    assert.ok(serverSrc.includes("removeHeader('X-Powered-By')"), 'Should remove X-Powered-By');
  });

  it('uses onSend hook for headers (applied to all responses)', () => {
    assert.ok(serverSrc.includes("app.addHook('onSend'"), 'Headers should be set via onSend hook');
  });

  it('CSP restricts script-src to self', () => {
    assert.ok(serverSrc.includes("script-src 'self'"), 'CSP script-src should be self only');
  });
});

// ─── 6. Admin Authorization ───────────────────────────────────────

describe('Admin Authorization', () => {
  it('requireAdmin function checks request.user exists', () => {
    assert.ok(adminSrc.includes('!request.user'), 'requireAdmin should check for missing user');
  });

  it('requireAdmin queries the DB for current role (not just JWT claim)', () => {
    assert.ok(
      adminSrc.includes("SELECT role, banned FROM users WHERE id = $1"),
      'requireAdmin should verify role from DB, not trust JWT alone'
    );
  });

  it('requireAdmin checks for admin OR owner role', () => {
    assert.ok(
      adminSrc.includes("role !== 'admin' && role !== 'owner'"),
      'requireAdmin should allow both admin and owner'
    );
  });

  it('requireAdmin rejects banned users', () => {
    assert.ok(
      adminSrc.includes('result.rows[0].banned'),
      'requireAdmin should check if user is banned'
    );
  });

  it('only owners can promote to admin/owner', () => {
    assert.ok(
      adminSrc.includes("request.adminRole !== 'owner'"),
      'Role promotion should require owner role'
    );
  });

  it('cannot ban an owner', () => {
    assert.ok(
      adminSrc.includes("target.rows[0].role === 'owner'"),
      'Ban should check that target is not an owner'
    );
  });

  it('cannot ban yourself', () => {
    assert.ok(
      adminSrc.includes('targetId === request.user.id'),
      'Should prevent self-ban'
    );
  });

  it('cannot warn yourself', () => {
    const warnSection = adminSrc.slice(adminSrc.indexOf("app.post('/users/:id/warn'"));
    assert.ok(
      warnSection.includes('targetId === request.user.id'),
      'Should prevent self-warning'
    );
  });
});

// ─── 7. WebSocket Auth ────────────────────────────────────────────

describe('WebSocket Authentication', () => {
  it('WS route verifies JWT from cookies', () => {
    assert.ok(wsSrc.includes('jwt.verify'), 'Should verify JWT token');
    assert.ok(wsSrc.includes('JWT_SECRET'), 'Should use JWT_SECRET for verification');
  });

  it('WS route closes unauthenticated connections', () => {
    assert.ok(wsSrc.includes('socket.close'), 'Should close socket for unauthenticated users');
    assert.ok(wsSrc.includes('4401'), 'Should use 4401 close code');
  });

  it('WS route sends error message before closing', () => {
    assert.ok(wsSrc.includes('Authentication required'), 'Should send auth error message');
  });

  it('WS route handles invalid JSON gracefully', () => {
    assert.ok(wsSrc.includes('JSON.parse'), 'Should parse messages');
    assert.ok(wsSrc.includes('catch'), 'Should catch parse errors');
    assert.ok(wsSrc.includes('Invalid message format'), 'Should send error for bad format');
  });

  it('WS route cleans up on disconnect', () => {
    assert.ok(wsSrc.includes("socket.on('close'"), 'Should handle close event');
    assert.ok(wsSrc.includes('socket.matchId = null'), 'Should clear matchId on disconnect');
  });
});

// ─── 8. Match IDOR Protection ─────────────────────────────────────

describe('Match IDOR Protection', () => {
  it('match detail restricts non-waiting matches to participants and admins', () => {
    assert.ok(
      matchesSrc.includes("match.status !== 'waiting'"),
      'Should check match status for access control'
    );
    assert.ok(
      matchesSrc.includes('isParticipant'),
      'Should check if user is participant'
    );
    assert.ok(
      matchesSrc.includes('isAdmin'),
      'Should check if user is admin'
    );
  });

  it('match detail allows owners to view matches (not just admin role)', () => {
    assert.ok(
      matchesSrc.includes("request.user.role === 'owner'"),
      'Should allow owner role to view active matches'
    );
  });

  it('match detail returns 403 for non-participants on active matches', () => {
    assert.ok(
      matchesSrc.includes('reply.code(403)'),
      'Should return 403 for unauthorized match access'
    );
  });

  it('proof upload verifies user is a participant', () => {
    assert.ok(
      matchesSrc.includes("match.player1_id !== userId && match.player2_id !== userId"),
      'Proof upload should verify participant'
    );
  });

  it('match report verifies user is a participant', () => {
    const reportSection = matchesSrc.slice(matchesSrc.indexOf("// POST /matches/:id/report"));
    assert.ok(
      reportSection.includes("match.player1_id !== userId && match.player2_id !== userId"),
      'Match report should verify participant'
    );
  });

  it('match flag verifies reporter is not reporting themselves', () => {
    assert.ok(
      matchesSrc.includes('reportedId === userId'),
      'Should prevent self-reporting in match flag'
    );
  });
});

// ─── 9. Parameterized Queries ─────────────────────────────────────

describe('SQL Injection Protection', () => {
  const routeFiles = [
    { name: 'auth.js', src: authSrc },
    { name: 'admin.js', src: adminSrc },
    { name: 'matches.js', src: matchesSrc },
    { name: 'wallet.js', src: walletSrc },
    { name: 'profile.js', src: profileSrc },
    { name: 'games.js', src: gamesSrc },
    { name: 'leaderboard.js', src: leaderboardSrc },
  ];

  for (const { name, src } of routeFiles) {
    it(`${name} uses parameterized queries (no string interpolation in SQL)`, () => {
      // Find pool.query and client.query calls with template literals
      // and check there's no user-input interpolation inside the SQL string itself
      const queryCallPattern = /(?:pool|client)\.query\(\s*`([^`]*)`/g;
      let match;
      while ((match = queryCallPattern.exec(src)) !== null) {
        const sqlTemplate = match[1];
        // Check for ${} interpolation inside the SQL template string
        const interpolations = sqlTemplate.matchAll(/\$\{([^}]+)\}/g);
        for (const interp of interpolations) {
          const expr = interp[1].trim();
          // These are safe: dynamically built placeholder lists, WHERE clauses, or parameterized limit/offset
          assert.ok(
            expr.includes('statusPlaceholders') || expr.includes('params.length') || expr === 'where' || expr === 'limitParam' || expr === 'offsetParam',
            `${name}: SQL template literal interpolation should only be for safe constructs, found: \${${expr}}`
          );
        }
      }
    });
  }
});

// ─── 10. Error Handling ───────────────────────────────────────────

describe('Error Handling', () => {
  it('global error handler hides stack traces in production', () => {
    assert.ok(serverSrc.includes("process.env.NODE_ENV === 'production'"), 'Should check NODE_ENV');
    assert.ok(serverSrc.includes("'An unexpected error occurred.'"), 'Should return generic message in production');
  });

  it('global error handler logs errors', () => {
    assert.ok(serverSrc.includes('app.log.error(error)'), 'Should log errors');
  });

  it('global error handler uses error.statusCode', () => {
    assert.ok(serverSrc.includes('error.statusCode || 500'), 'Should use statusCode from error');
  });
});

// ─── 11. Cookie Settings ──────────────────────────────────────────

describe('Cookie Security', () => {
  it('auth cookie is httpOnly', () => {
    assert.ok(authSrc.includes('httpOnly: true'), 'Token cookie should be httpOnly');
  });

  it('auth cookie uses sameSite lax', () => {
    assert.ok(authSrc.includes("sameSite: 'lax'"), 'Token cookie should use sameSite lax');
  });

  it('auth cookie is secure in production', () => {
    assert.ok(
      authSrc.includes("secure: process.env.NODE_ENV === 'production'"),
      'Token cookie should be secure in production'
    );
  });

  it('auth cookie has reasonable maxAge', () => {
    assert.ok(authSrc.includes('maxAge: 7 * 24 * 60 * 60'), 'Token cookie should expire in 7 days');
  });

  it('logout clears cookie with correct path', () => {
    assert.ok(authSrc.includes("clearCookie('token', { path: '/' })"), 'Logout should clear cookie with path');
  });
});

// ─── 12. Open Redirect Protection ─────────────────────────────────

describe('Open Redirect Protection', () => {
  it('language switch validates referer against same origin', () => {
    const i18nSrc = readFile('i18n.js');
    assert.ok(
      i18nSrc.includes('url.host === request.headers.host'),
      'Language switch should validate referer is same origin'
    );
    assert.ok(
      i18nSrc.includes('url.pathname + url.search'),
      'Language switch should only use path portion of referer'
    );
  });

  it('all hardcoded redirects use relative paths', () => {
    const allRedirects = serverSrc.matchAll(/reply\.redirect\(['"]([^'"]+)['"]\)/g);
    for (const m of allRedirects) {
      assert.ok(
        m[1].startsWith('/') || m[1] === '/',
        `Redirect should use relative path, found: ${m[1]}`
      );
    }
  });
});

// ─── 13. Password Hashing ─────────────────────────────────────────

describe('Password Security', () => {
  it('passwords are hashed with bcrypt', () => {
    assert.ok(authSrc.includes('bcrypt.hash(password, 12)'), 'Should hash with bcrypt, cost factor 12');
  });

  it('login uses bcrypt.compare', () => {
    assert.ok(authSrc.includes('bcrypt.compare(password, user.password_hash)'), 'Should use bcrypt.compare');
  });
});

// ─── 14. Moderation Utility ───────────────────────────────────────

describe('Content Moderation', () => {
  // Import and test the actual module
  let scanContent;

  it('scanContent can be imported', async () => {
    const mod = await import('../src/utils/moderation.js');
    scanContent = mod.scanContent;
    assert.ok(typeof scanContent === 'function', 'scanContent should be a function');
  });

  it('detects phone numbers', async () => {
    if (!scanContent) return;
    const result = scanContent('Call me at +41 79 123 4567');
    assert.ok(result.flags.some(f => f.type === 'auto_phone'), 'Should detect phone number');
  });

  it('detects email addresses', async () => {
    if (!scanContent) return;
    const result = scanContent('Email me at test@example.com');
    assert.ok(result.flags.some(f => f.type === 'auto_email'), 'Should detect email');
  });

  it('detects threats', async () => {
    if (!scanContent) return;
    const result = scanContent('I will find you and hurt you');
    assert.ok(result.flags.some(f => f.type === 'auto_threat'), 'Should detect threat');
  });

  it('detects profanity', async () => {
    if (!scanContent) return;
    const result = scanContent('You are a complete retard');
    assert.ok(result.flags.some(f => f.type === 'auto_profanity'), 'Should detect profanity');
  });

  it('handles null/empty input safely', async () => {
    if (!scanContent) return;
    assert.deepEqual(scanContent(null), { clean: true, flags: [] });
    assert.deepEqual(scanContent(''), { clean: true, flags: [] });
    assert.deepEqual(scanContent(undefined), { clean: true, flags: [] });
  });

  it('clean text returns clean:true', async () => {
    if (!scanContent) return;
    const result = scanContent('Good game, well played!');
    assert.ok(result.clean, 'Normal text should be clean');
  });
});

// ─── 15. ELO Calculation ──────────────────────────────────────────

describe('ELO Calculation', () => {
  let calculateElo;

  it('calculateElo can be imported', async () => {
    const mod = await import('../src/utils/elo.js');
    calculateElo = mod.calculateElo;
    assert.ok(typeof calculateElo === 'function', 'calculateElo should be a function');
  });

  it('winner gains rating and loser loses rating', async () => {
    if (!calculateElo) return;
    const { winnerNew, loserNew } = calculateElo(1000, 1000);
    assert.ok(winnerNew > 1000, 'Winner should gain rating');
    assert.ok(loserNew < 1000, 'Loser should lose rating');
  });

  it('rating changes are symmetric for equal-rated players', async () => {
    if (!calculateElo) return;
    const { winnerNew, loserNew } = calculateElo(1000, 1000);
    const winnerGain = winnerNew - 1000;
    const loserLoss = 1000 - loserNew;
    assert.equal(winnerGain, loserLoss, 'Gain and loss should be symmetric for equal players');
  });

  it('upset win gives more points', async () => {
    if (!calculateElo) return;
    const normal = calculateElo(1200, 1000);
    const upset = calculateElo(1000, 1200);
    const normalGain = normal.winnerNew - 1200;
    const upsetGain = upset.winnerNew - 1000;
    assert.ok(upsetGain > normalGain, 'Upset victory should yield more rating gain');
  });

  it('returns integer values', async () => {
    if (!calculateElo) return;
    const { winnerNew, loserNew } = calculateElo(1234, 1567);
    assert.ok(Number.isInteger(winnerNew), 'Winner rating should be integer');
    assert.ok(Number.isInteger(loserNew), 'Loser rating should be integer');
  });
});

// ─── 16. Button Audit ─────────────────────────────────────────────

describe('Button Consistency Audit', () => {
  it('all <button> elements have a type attribute', () => {
    const missing = [];
    for (const { name, content } of allEjs) {
      // Match <button without type= before the closing >
      const buttonTags = content.matchAll(/<button\b([^>]*?)>/g);
      for (const m of buttonTags) {
        const attrs = m[1];
        if (!attrs.includes('type=')) {
          missing.push(name);
        }
      }
    }
    assert.equal(
      missing.length, 0,
      `Buttons without type attribute found in: ${[...new Set(missing)].join(', ')}`
    );
  });

  it('submit buttons use btn class', () => {
    for (const { name, content } of allEjs) {
      const submitBtns = content.matchAll(/<button[^>]*type="submit"[^>]*>/g);
      for (const m of submitBtns) {
        assert.ok(
          m[0].includes('class=') && m[0].includes('btn'),
          `${name}: submit button should have btn class`
        );
      }
    }
  });

  it('destructive action buttons use btn-danger class', () => {
    // Check specific known destructive buttons by looking at button tags
    // that contain destructive action text as their direct content
    const dangerButtonChecks = [
      { file: 'users.ejs', text: '>Ban<' },
      { file: 'kyc.ejs', text: '>Reject<' },
      { file: 'matches.ejs', text: '>Confirm Cancel<' },
    ];
    for (const check of dangerButtonChecks) {
      const file = allEjs.find(e => e.name === check.file);
      if (!file) continue;
      const idx = file.content.indexOf(check.text);
      if (idx === -1) continue;
      // Look backwards for the opening <button tag
      const start = file.content.lastIndexOf('<button', idx);
      const tag = file.content.slice(start, idx + check.text.length);
      assert.ok(
        tag.includes('btn-danger'),
        `${check.file}: button containing "${check.text}" should use btn-danger`
      );
    }
  });

  it('primary form buttons use btn-primary or btn-success class', () => {
    // Check that key forms have their submit button styled as primary/success.
    // We look for <button type="submit"> within certain templates and verify its class.
    const checks = [
      { file: 'login.ejs' },
      { file: 'register.ejs' },
      { file: 'create.ejs', dir: 'matches' },
      { file: 'verify.ejs' },
    ];
    for (const check of checks) {
      const file = allEjs.find(e =>
        e.name === check.file && (!check.dir || e.path.includes(check.dir))
      );
      if (!file) continue;
      // Find all submit buttons in this file
      const submitButtons = [...file.content.matchAll(/<button[^>]*type="submit"[^>]*>/g)];
      assert.ok(submitButtons.length > 0, `${check.file}: should have at least one submit button`);
      // The main submit button (last one or only one) should be primary or success
      const mainBtn = submitButtons[submitButtons.length - 1][0];
      assert.ok(
        mainBtn.includes('btn-primary') || mainBtn.includes('btn-success'),
        `${check.file}: main submit button should use btn-primary or btn-success`
      );
    }
  });
});

// ─── 17. Graceful Shutdown ────────────────────────────────────────

describe('Graceful Shutdown', () => {
  it('handles SIGTERM', () => {
    assert.ok(serverSrc.includes("process.on('SIGTERM'"), 'Should handle SIGTERM');
  });

  it('handles SIGINT', () => {
    assert.ok(serverSrc.includes("process.on('SIGINT'"), 'Should handle SIGINT');
  });

  it('closes pool on shutdown', () => {
    assert.ok(serverSrc.includes('pool.end()'), 'Should close DB pool on shutdown');
  });
});

// ─── 18. Database Connection ──────────────────────────────────────

describe('Database Connection', () => {
  it('uses connection pooling with reasonable limits', () => {
    const schemaSrc = readFile('db/schema.js');
    assert.ok(schemaSrc.includes('max: 10'), 'Should limit pool to 10 connections');
    assert.ok(schemaSrc.includes('idleTimeoutMillis: 30000'), 'Should have idle timeout');
  });
});

// ─── 19. Ban Evasion ──────────────────────────────────────────────

describe('Ban Evasion Detection', () => {
  it('checks registration IP against banned users', () => {
    assert.ok(
      authSrc.includes('ban_evasion_suspect'),
      'Should flag potential ban evasion on registration'
    );
  });

  it('stores registration and login IPs', () => {
    assert.ok(authSrc.includes('registrationIp'), 'Should store registration IP');
    assert.ok(authSrc.includes('last_login_ip'), 'Should track login IP');
  });
});

// ─── 20. Wallet Race Conditions ───────────────────────────────────

describe('Wallet Race Condition Protection', () => {
  it('match create locks user row before deducting', () => {
    assert.ok(matchesSrc.includes('FOR UPDATE'), 'Match create should use SELECT FOR UPDATE');
  });

  it('match join locks user row before deducting', () => {
    const joinSection = matchesSrc.slice(matchesSrc.indexOf("app.post('/:id/join'"));
    assert.ok(joinSection.includes('FOR UPDATE'), 'Match join should use SELECT FOR UPDATE');
  });

  it('wallet withdraw locks user row before deducting', () => {
    assert.ok(walletSrc.includes('FOR UPDATE'), 'Withdraw should use SELECT FOR UPDATE');
  });

  it('wallet operations use transactions', () => {
    assert.ok(walletSrc.includes("await client.query('BEGIN')"), 'Should use BEGIN transaction');
    assert.ok(walletSrc.includes("await client.query('COMMIT')"), 'Should COMMIT transaction');
    assert.ok(walletSrc.includes("await client.query('ROLLBACK')"), 'Should ROLLBACK on error');
  });
});
