import Fastify from 'fastify';
import fastifyView from '@fastify/view';
import fastifyStatic from '@fastify/static';
import fastifyFormbody from '@fastify/formbody';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import ejs from 'ejs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

import authRoutes from './routes/auth.js';
import gamesRoutes from './routes/games.js';
import matchesRoutes from './routes/matches.js';
import leaderboardRoutes from './routes/leaderboard.js';
import walletRoutes from './routes/wallet.js';
import profileRoutes from './routes/profile.js';
import wsRoutes from './routes/ws.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = Fastify({
  logger: true,
  trustProxy: true,
  bodyLimit: 1048576, // 1 MB
});

// Security headers
app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '0');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
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

// Global error handler
app.setErrorHandler((error, request, reply) => {
  app.log.error(error);
  const statusCode = error.statusCode || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : error.message;
  reply.code(statusCode).send({ error: message });
});

// --- Plugins ---
await app.register(fastifyFormbody);
await app.register(fastifyCookie, {
  secret: process.env.COOKIE_SECRET || 'change-me',
});
await app.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
await app.register(fastifyWebsocket);
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
});
// NOTE: Removed /static/ route that exposed entire src/ directory (security risk).
// If static assets beyond /public/ are needed, serve a specific subdirectory instead.

// --- Auth decorator ---
app.decorateRequest('user', null);
app.addHook('onRequest', async (request, reply) => {
  const token = request.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'change-me');
      request.user = decoded;
    } catch {
      // Invalid token, continue as guest
    }
  }
});

// Pass user to all views
app.addHook('preHandler', async (request, reply) => {
  if (reply.locals === undefined) reply.locals = {};
  reply.locals.user = request.user;
});

// --- Routes ---
await app.register(authRoutes, { prefix: '/auth' });
await app.register(gamesRoutes, { prefix: '/games' });
await app.register(matchesRoutes, { prefix: '/matches' });
await app.register(leaderboardRoutes, { prefix: '/leaderboard' });
await app.register(walletRoutes, { prefix: '/wallet' });
await app.register(profileRoutes, { prefix: '/profile' });
await app.register(wsRoutes);

// --- DB ---
import { pool } from './db/schema.js';

// --- Homepage ---
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

// --- Health check ---
app.get('/health', async () => {
  return { status: 'ok', service: 'duelstake', timestamp: new Date().toISOString() };
});

// --- Graceful shutdown ---
const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// --- Start ---
const PORT = parseInt(process.env.PORT || '4004', 10);
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`DuelStake running on http://0.0.0.0:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
