import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/schema.js';
import { logUserActivity } from './admin.js';

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
    const t = reply.locals.t;
    const { email, username, password, display_name } = request.body;

    if (!email || !username || !password) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_fields_required'),
      });
    }

    if (!EMAIL_RE.test(email) || email.length > 255) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_invalid_email'),
      });
    }

    if (username.length < 3 || username.length > 50) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_username_length'),
      });
    }

    if (password.length < 8 || password.length > 1000) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_password_length'),
      });
    }

    if (display_name && display_name.length > 100) {
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_display_name_length'),
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
          error: t('auth.err_already_taken'),
        });
      }

      const password_hash = await bcrypt.hash(password, 12);
      const registrationIp = request.ip;
      const result = await pool.query(
        `INSERT INTO users (email, username, password_hash, display_name, registration_ip, last_login_ip)
         VALUES ($1, $2, $3, $4, $5, $5) RETURNING id, username, display_name, elo_rating`,
        [email.toLowerCase(), username.toLowerCase(), password_hash, display_name || username, registrationIp]
      );

      const user = result.rows[0];

      // Ban evasion check - check if any banned user has same IP
      try {
        const ipMatches = await pool.query(
          `SELECT id, username, email, banned_reason FROM users
           WHERE banned = true
             AND id != $1
             AND (registration_ip = $2 OR last_login_ip = $2)`,
          [user.id, registrationIp]
        );
        if (ipMatches.rows.length > 0) {
          const matchedUser = ipMatches.rows[0];
          await pool.query(
            `INSERT INTO flags (type, user_id, reported_user_id, details)
             VALUES ('ban_evasion_suspect', $1, $1, $2)`,
            [user.id, `New registration IP ${registrationIp} matches banned user ${matchedUser.username} (ID: ${matchedUser.id})`]
          );
        }
      } catch (err) {
        // Non-critical check, don't block registration
        console.error('[anti-evasion] Check failed:', err.message);
      }

      // Log activity
      logUserActivity(user.id, 'register', registrationIp, 'Account created');

      const token = jwt.sign(
        { id: user.id, username: user.username, display_name: user.display_name, role: 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, COOKIE_OPTS);
      return reply.redirect('/');
    } catch (err) {
      app.log.error(err);
      return reply.view('auth/register.ejs', {
        user: request.user,
        error: t('auth.err_registration_failed'),
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
    const t = reply.locals.t;
    const { email, password } = request.body;

    if (!email || !password) {
      return reply.view('auth/login.ejs', {
        user: request.user,
        error: t('auth.err_email_password_required'),
      });
    }

    try {
      const result = await pool.query(
        'SELECT id, username, display_name, password_hash, elo_rating, role, banned, banned_reason, banned_at FROM users WHERE email = $1',
        [email.toLowerCase()]
      );

      if (result.rows.length === 0) {
        return reply.view('auth/login.ejs', {
          user: request.user,
          error: t('auth.err_invalid_credentials'),
        });
      }

      const user = result.rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);

      if (!valid) {
        return reply.view('auth/login.ejs', {
          user: request.user,
          error: t('auth.err_invalid_credentials'),
        });
      }

      // Check if user is banned
      if (user.banned) {
        return reply.view('auth/banned.ejs', {
          user: null,
          reason: user.banned_reason,
          bannedAt: user.banned_at,
        });
      }

      // Update last login IP
      const loginIp = request.ip;
      await pool.query('UPDATE users SET last_login_ip = $1 WHERE id = $2', [loginIp, user.id]);

      // Log activity
      logUserActivity(user.id, 'login', loginIp, 'User logged in');

      const token = jwt.sign(
        { id: user.id, username: user.username, display_name: user.display_name, role: user.role || 'user' },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      reply.setCookie('token', token, COOKIE_OPTS);
      return reply.redirect('/');
    } catch (err) {
      app.log.error(err);
      return reply.view('auth/login.ejs', {
        user: request.user,
        error: t('auth.err_login_failed'),
      });
    }
  });

  // GET /auth/logout
  app.get('/logout', async (request, reply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.redirect('/');
  });
}
