import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyCompress from '@fastify/compress';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

import { registerI18n } from './i18n.js';
import authRoutes from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import matchesRoutes from './routes/matches.js';
import leaderboardRoutes from './routes/leaderboard.js';
import walletRoutes from './routes/wallet.js';
import profileRoutes from './routes/profile.js';
import notificationRoutes from './routes/notifications.js';
import wsRoutes from './routes/ws.js';
import adminRoutes, { runAdminMigrations } from './routes/admin.js';
import { pool } from './db/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Environment validation: fail fast in production if secrets are missing or default ---
if (process.env.NODE_ENV === 'production') {
  const required = ['JWT_SECRET', 'COOKIE_SECRET', 'DATABASE_URL'];
  const defaults = ['change-me', 'change-me-to-a-strong-secret'];
  for (const key of required) {
    const val = process.env[key];
    if (!val) {
      console.error(`FATAL: ${key} is not set. Refusing to start in production.`);
      process.exit(1);
    }
    if (defaults.includes(val)) {
      console.error(`FATAL: ${key} is set to a default/insecure value. Refusing to start in production.`);
      process.exit(1);
    }
  }
}

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 1048576, // 1 MB
});

// Security headers
app.addHook('onSend', async (request, reply) => {
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; connect-src 'self'");
  reply.removeHeader('X-Powered-By');
});

// Rate limiting for auth routes (in-memory, per IP)
const authAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const RATE_LIMIT_MAX = 10;

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authAttempts) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW) authAttempts.delete(key);
  }
}, 60 * 1000);

app.decorate('checkAuthRateLimit', (request, reply) => {
  const ip = request.ip;
  const now = Date.now();
  let entry = authAttempts.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW) {
    entry = { count: 0, windowStart: now };
    authAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    reply.code(429).send('Too many attempts. Please try again later.');
    return false;
  }
  return true;
});

// Rate limiting for action routes (match create/join, wallet deposit/withdraw)
const actionAttempts = new Map();
const ACTION_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const ACTION_RATE_LIMIT_MAX = 15; // 15 actions per minute

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of actionAttempts) {
    if (now - entry.windowStart > ACTION_RATE_LIMIT_WINDOW) actionAttempts.delete(key);
  }
}, 30 * 1000);

app.decorate('checkActionRateLimit', (request, reply) => {
  const ip = request.ip;
  const now = Date.now();
  let entry = actionAttempts.get(ip);
  if (!entry || now - entry.windowStart > ACTION_RATE_LIMIT_WINDOW) {
    entry = { count: 0, windowStart: now };
    actionAttempts.set(ip, entry);
  }
  entry.count++;
  if (entry.count > ACTION_RATE_LIMIT_MAX) {
    reply.code(429).send('Too many requests. Please slow down.');
    return false;
  }
  return true;
});

// Global error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : error.message;
  reply.code(statusCode).send({ error: message });
});

// Plugins
await app.register(fastifyFormbody);
await app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET || 'change-me',
});
await app.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
await app.register(fastifyWebsocket);
await app.register(fastifyCompress, { global: true });
await app.register(fastifyView, {
  engine: { ejs },
  root: path.join(__dirname, 'views'),
  defaultContext: { user: null },
  production: process.env.NODE_ENV === 'production',
});
await app.register(fastifyStatic, {
  root: path.join(__dirname, 'public'),
  prefix: '/public/',
  maxAge: process.env.NODE_ENV === 'production' ? 86400000 : 0,
  etag: true,
  lastModified: true,
});
// NOTE: Removed /static/ route that exposed entire src/ directory (security risk).
// If static assets beyond /public/ are needed, serve a specific subdirectory instead.

// Auth decorator
app.decorateRequest('user', null);
app.addHook('onRequest', async (request, reply) => {
  const token = request.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
      // Check if user is banned
      const banCheck = await pool.query('SELECT banned, banned_reason, banned_at FROM users WHERE id = $1', [decoded.id]);
      if (banCheck.rows.length > 0 && banCheck.rows[0].banned) {
        reply.clearCookie('token', { path: '/' });
        request.user = null;
        return;
      }
      request.user = decoded;
    } catch {
      // Invalid token, continue as guest
    }
  }
});

// --- CSRF Protection: Double Submit Cookie pattern ---
const CSRF_SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_SKIP_PREFIXES = ['/api/', '/health', '/ws'];

// onRequest: set _csrf cookie if missing
app.addHook('onRequest', async (request, reply) => {
  if (!request.cookies._csrf) {
    const token = randomBytes(32).toString('hex');
    reply.setCookie('_csrf', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    });
    request.csrfToken = token;
  } else {
    request.csrfToken = request.cookies._csrf;
  }
});

// preHandler: validate _csrf on state-changing methods
app.addHook('preHandler', async (request, reply) => {
  if (CSRF_SKIP_METHODS.has(request.method)) return;
  // Skip API routes, health check, and WebSocket upgrades
  if (CSRF_SKIP_PREFIXES.some(p => request.url.startsWith(p))) return;
  if (request.headers.upgrade === 'websocket') return;

  // Skip multipart forms here; they validate CSRF in their route handlers
  // because the body must be streamed and parsed manually.
  const ct = request.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) return;

  const cookieToken = request.cookies._csrf;
  if (!cookieToken) {
    reply.code(403).send('CSRF validation failed: missing token cookie');
    return;
  }

  const bodyToken = request.body && request.body._csrf;
  if (!bodyToken || bodyToken !== cookieToken) {
    reply.code(403).send('CSRF validation failed: token mismatch');
    return;
  }
});

// Pass user and notification count to all views
app.addHook('preHandler', async (request, reply) => {
  if (reply.locals === undefined) reply.locals = {};
  reply.locals.user = request.user;
  reply.locals.unreadNotifications = 0;
  // Inject csrfToken for all views
  reply.locals.csrfToken = request.csrfToken || request.cookies._csrf || '';
  if (request.user) {
    try {
      const result = await pool.query(
        `SELECT COUNT(*) as count FROM notifications WHERE user_id = $1 AND read = false`,
        [request.user.id]
      );
      reply.locals.unreadNotifications = parseInt(result.rows[0].count);
    } catch { /* ignore */ }
  }
});

// i18n: load locale, inject t() and lang into all views
registerI18n(app);

// Routes
await app.register(authRoutes, { prefix: '/auth' });
await app.register(gamesRoutes, { prefix: '/games' });
await app.register(matchesRoutes, { prefix: '/matches' });
await app.register(leaderboardRoutes, { prefix: '/leaderboard' });
await app.register(walletRoutes, { prefix: '/wallet' });
await app.register(profileRoutes, { prefix: '/profile' });
await app.register(notificationRoutes, { prefix: '/notifications' });
await app.register(adminRoutes, { prefix: '/admin' });
await app.register(wsRoutes);

// FAQ
app.get('/faq', async (request, reply) => {
  return reply.view('faq.ejs', { user: request.user });
});

// Homepage
app.get('/', async (request, reply) => {
  try {
    const [gamesResult, matchCountResult, topPlayersResult] = await Promise.all([
      pool.query('SELECT * FROM games WHERE active = true ORDER BY name'),
      pool.query("SELECT COUNT(*) as count FROM matches WHERE status IN ('waiting', 'active')"),
      pool.query(
        `SELECT u.username, u.display_name, u.elo_rating, u.avatar_path
         FROM users u ORDER BY u.elo_rating DESC LIMIT 5`
      ),
    ]);
    return reply.view('index.ejs', {
      user: request.user,
      games: gamesResult.rows,
      activeMatchCount: matchCountResult.rows[0].count,
      topPlayers: topPlayersResult.rows,
    });
  } catch {
    return reply.view('index.ejs', {
      user: request.user,
      games: [],
      activeMatchCount: 0,
      topPlayers: [],
    });
  }
});

// Health check
app.get('/health', async () => {
  return { status: 'ok', service: 'duelstake', timestamp: new Date().toISOString() };
});

// Graceful shutdown
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
await runAdminMigrations();

const PORT = parseInt(process.env.PORT || '4004', 10);
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`DuelStake running on http://0.0.0.0:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
