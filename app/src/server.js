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
});
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', '..', 'src'),
  prefix: '/static/',
  decorateReply: false,
});

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

// --- Homepage ---
app.get('/', async (request, reply) => {
  const { pool } = await import('./db/schema.js');
  try {
    const gamesResult = await pool.query(
      'SELECT * FROM games WHERE active = true ORDER BY name'
    );
    const matchCountResult = await pool.query(
      "SELECT COUNT(*) as count FROM matches WHERE status IN ('waiting', 'active')"
    );
    const topPlayersResult = await pool.query(
      `SELECT u.username, u.display_name, u.elo_rating, u.avatar_path
       FROM users u ORDER BY u.elo_rating DESC LIMIT 5`
    );
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

// --- Start ---
const PORT = parseInt(process.env.PORT || '4004', 10);
try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  app.log.info(`DuelStake running on http://0.0.0.0:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
