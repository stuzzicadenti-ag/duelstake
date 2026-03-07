import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/schema.js';

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_OPTS = {
  httpOnly: true,
  secure: false, // behind Caddy reverse proxy on HTTP/Tailscale
  sameSite: 'lax',
  path: '/',
  maxAge: 7 * 24 * 60 * 60, // 7 days
};

export default async function authRoutes(app) {
  // GET /auth/register
  app.get('/register', async (request, reply) => {
    return reply.view('auth/register.ejs', { user: request.user, error: null });
  });

  // POST /auth/register
  app.post('/register', async (request, reply) => {
    if (app.checkAuthRateLimit && !app.checkAuthRateLimit(request, reply)) return;
    const { email, username, password, display_name } = request.body;

    if (!email || !username || !password) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Email, username, and password are required.',
      });
    }

    if (!EMAIL_RE.test(email) || email.length > 255) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Invalid email format.',
      });
    }

    if (username.length < 3 || username.length > 50) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Username must be 3-50 characters.',
      });
    }

    if (password.length < 8 || password.length > 1000) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Password must be 8-1000 characters.',
      });
    }

    if (display_name && display_name.length > 100) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Display name must be under 100 characters.',
      });
    }

    try {
      const existing = await pool.query(
        'SELECT id FROM users WHERE email = $1 OR username = $2',
        [email.toLowerCase(), username.toLowerCase()]
      );
      if (existing.rows.length > 0) {
        return reply.view('auth/register.ejs', {
          user: request.user,
          error: 'Email or username already taken.',
        });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const result = await pool.query(
        `INSERT INTO users (email, username, password_hash, display_name)
         VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, elo_rating`,
        [email.toLowerCase(), username.toLowerCase(), password_hash, display_name || username]
      );

      const user = result.rows[0];
      const token = jwt.sign(
        { id: user.id, username: user.username, display_name: user.display_name },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, COOKIE_OPTS);
      return reply.redirect('/');
    } catch (err) {
      app.log.error(err);
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: 'Registration failed. Please try again.',
      });
    }
  });

  // GET /auth/login
  app.get('/login', async (request, reply) => {
    return reply.view('auth/login.ejs', { user: request.user, error: null });
  });

  // POST /auth/login
  app.post('/login', async (request, reply) => {
    if (app.checkAuthRateLimit && !app.checkAuthRateLimit(request, reply)) return;
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.view('auth/login.ejs', {
        user: request.user,
        error: 'Email and password are required.',
      });
    }

    try {
      const result = await pool.query(
        'SELECT id, username, display_name, password_hash, elo_rating FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return reply.view('auth/login.ejs', {
          user: request.user,
          error: 'Invalid email or password.',
        });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return reply.view('auth/login.ejs', {
          user: request.user,
          error: 'Invalid email or password.',
        });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, display_name: user.display_name },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, COOKIE_OPTS);
      return reply.redirect('/');
    } catch (err) {
      app.log.error(err);
      return reply.view('auth/login.ejs', {
        user: request.user,
        error: 'Login failed. Please try again.',
      });
    }
  });

  // GET /auth/logout
  app.get('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.redirect('/');
  });
}
