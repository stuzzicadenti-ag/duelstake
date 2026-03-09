import { pool } from '../db/schema.js';
import { calculateElo } from '../utils/elo.js';
import { scanContent } from '../utils/moderation.js';
import { logUserActivity } from './admin.js';
import path from 'path';
import fs from 'fs/promises';

function requireAuth(request, reply) {
  if (!request.user) {
    return reply.redirect('/auth/login');
  }
}

export default async function matchesRoutes(app) {
  // GET /matches - User's matches
  app.get('/', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const userId = request.user.id;
    const tab = request.query.tab || 'active';

    // Use parameterized statuses instead of string interpolation
    let statuses;
    if (tab === 'completed') statuses = ['completed'];
    else if (tab === 'disputed') statuses = ['disputed'];
    else statuses = ['waiting', 'active', 'proof_required'];

    const statusPlaceholders = statuses.map((_, i) => `$${i + 2}`).join(', ');

    const matches = await pool.query(
      `SELECT m.*, g.name as game_name, g.slug as game_slug, g.icon as game_icon,
              u1.username as player1_name, u2.username as player2_name,
              uw.username as winner_name
       FROM matches m
       JOIN games g ON m.game_id = g.id
       JOIN users u1 ON m.player1_id = u1.id
       LEFT JOIN users u2 ON m.player2_id = u2.id
       LEFT JOIN users uw ON m.winner_id = uw.id
       WHERE (m.player1_id = $1 OR m.player2_id = $1)
         AND m.status IN (${statusPlaceholders})
       ORDER BY m.created_at DESC
       LIMIT 50`,
      [userId, ...statuses]
    );

    return reply.view('matches/list.ejs', {
      user: request.user,
      matches: matches.rows,
      tab,
    });
  });

  // GET /matches/create - Create match form
  app.get('/create', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const gameSlug = request.query.game;
    const [games, walletResult] = await Promise.all([
      pool.query('SELECT * FROM games WHERE active = true ORDER BY name'),
      pool.query('SELECT wallet_balance FROM users WHERE id = $1', [request.user.id]),
    ]);

    let selectedGame = null;
    if (gameSlug) {
      const g = await pool.query('SELECT * FROM games WHERE slug = $1', [gameSlug]);
      if (g.rows.length > 0) selectedGame = g.rows[0];
    }

    const walletBalance = walletResult.rows[0] ? parseFloat(walletResult.rows[0].wallet_balance) : 0;

    return reply.view('matches/create.ejs', {
      user: request.user,
      games: games.rows,
      selectedGame,
      error: null,
      walletBalance,
    });
  });

  // POST /matches/create - Create a match
  app.post('/create', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const { game_id, stake_amount } = request.body;
    const userId = request.user.id;

    const game = await pool.query('SELECT * FROM games WHERE id = $1 AND active = true', [game_id]);
    if (game.rows.length === 0) {
      return reply.code(400).send('Invalid game');
    }

    const g = game.rows[0];
    const stake = parseFloat(stake_amount);

    // Check wallet balance early so we can show it in error views
    const wallet = await pool.query('SELECT wallet_balance FROM users WHERE id = $1', [userId]);
    const walletBalance = parseFloat(wallet.rows[0].wallet_balance);

    // KYC limit: unverified users max 50/match
    const kycCheck = await pool.query('SELECT kyc_status FROM users WHERE id = $1', [userId]);
    const kycStatus = kycCheck.rows[0]?.kyc_status || 'none';
    if (kycStatus !== 'verified' && stake > 50) {
      const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');
      return reply.view('matches/create.ejs', {
        user: request.user,
        games: games.rows,
        selectedGame: g,
        error: 'Unverified accounts are limited to \u20ac50/match. Verify your identity to unlock higher stakes.',
        walletBalance,
      });
    }

    if (isNaN(stake) || stake < parseFloat(g.min_stake) || stake > parseFloat(g.max_stake)) {
      const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');
      return reply.view('matches/create.ejs', {
        user: request.user,
        games: games.rows,
        selectedGame: g,
        error: `Stake must be between ${g.min_stake} and ${g.max_stake}.`,
        walletBalance,
      });
    }

    if (walletBalance < stake) {
      const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');
      return reply.view('matches/create.ejs', {
        user: request.user,
        games: games.rows,
        selectedGame: g,
        error: 'Insufficient balance. Please deposit funds first.',
        walletBalance,
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock user row to prevent race condition on concurrent stakes
      const lockedWallet = await client.query(
        'SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (parseFloat(lockedWallet.rows[0].wallet_balance) < stake) {
        await client.query('ROLLBACK');
        const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');
        return reply.view('matches/create.ejs', {
          user: request.user, games: games.rows, selectedGame: g,
          error: 'Insufficient balance. Please deposit funds first.', walletBalance: parseFloat(lockedWallet.rows[0].wallet_balance),
        });
      }

      // Deduct stake from wallet
      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
        [stake, userId]
      );

      // Record transaction
      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, description)
         VALUES ($1, 'stake', $2, $3)`,
        [userId, -stake, `Stake for ${g.name} match`]
      );

      // Create match
      const result = await client.query(
        `INSERT INTO matches (game_id, player1_id, stake_amount, status)
         VALUES ($1, $2, $3, 'waiting') RETURNING id`,
        [game_id, userId, stake]
      );

      await client.query('COMMIT');
      logUserActivity(userId, 'match_create', request.ip, `Match #${result.rows[0].id}, stake ${stake}`);
      return reply.redirect(`/matches/${result.rows[0].id}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /matches/:id/join - Join a waiting match
  app.post('/:id/join', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const matchId = request.params.id;
    const userId = request.user.id;

    const matchResult = await pool.query(
      "SELECT * FROM matches WHERE id = $1 AND status = 'waiting'",
      [matchId]
    );

    if (matchResult.rows.length === 0) {
      return reply.code(400).send('Match not available');
    }

    const match = matchResult.rows[0];
    if (match.player1_id === userId) {
      return reply.code(400).send('Cannot join your own match');
    }

    const stake = parseFloat(match.stake_amount);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock user row to prevent race condition on concurrent stakes
      const lockedWallet = await client.query(
        'SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (parseFloat(lockedWallet.rows[0].wallet_balance) < stake) {
        await client.query('ROLLBACK');
        return reply.redirect('/wallet?error=insufficient');
      }

      await client.query(
        'UPDATE users SET wallet_balance = wallet_balance - $1 WHERE id = $2',
        [stake, userId]
      );

      await client.query(
        `INSERT INTO wallet_transactions (user_id, type, amount, description)
         VALUES ($1, 'stake', $2, $3)`,
        [userId, -stake, 'Stake for match #' + matchId]
      );

      await client.query(
        `UPDATE matches SET player2_id = $1, status = 'active', started_at = NOW()
         WHERE id = $2`,
        [userId, matchId]
      );

      await client.query('COMMIT');
      logUserActivity(userId, 'match_join', request.ip, `Joined match #${matchId}`);
      return reply.redirect(`/matches/${matchId}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /matches/:id/proof - Upload proof
  app.post('/:id/proof', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const matchId = request.params.id;
    const userId = request.user.id;

    const matchResult = await pool.query(
      "SELECT * FROM matches WHERE id = $1 AND status IN ('active','proof_required')",
      [matchId]
    );

    if (matchResult.rows.length === 0) {
      return reply.code(400).send('Match not available for proof submission');
    }

    const match = matchResult.rows[0];
    if (match.player1_id !== userId && match.player2_id !== userId) {
      return reply.code(403).send('Not a participant');
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send('No file uploaded');
    }

    // Validate file type (extension + mimetype)
    const ALLOWED_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    const ext = path.extname(data.filename || '').toLowerCase() || '.png';
    if (!ALLOWED_EXTS.includes(ext) || !ALLOWED_MIMES.includes(data.mimetype)) {
      return reply.code(400).send('Invalid file type. Only images are allowed (jpg, png, webp, gif).');
    }

    const uploadDir = process.env.UPLOAD_DIR || './data/uploads';
    // Sanitize matchId to prevent path traversal
    const safeMatchId = String(parseInt(matchId, 10));
    if (safeMatchId === 'NaN') return reply.code(400).send('Invalid match ID');
    const dir = path.join(uploadDir, safeMatchId);
    await fs.mkdir(dir, { recursive: true });

    // Use UUID-style filename to avoid any path traversal via original filename
    const filename = `proof_${userId}_${Date.now()}${ext}`;
    const filePath = path.join(dir, filename);

    const buffer = await data.toBuffer();
    await fs.writeFile(filePath, buffer);

    const description = data.fields?.description?.value || '';

    await pool.query(
      `INSERT INTO match_proofs (match_id, user_id, file_path, description)
       VALUES ($1, $2, $3, $4)`,
      [matchId, userId, filePath, description]
    );

    await pool.query(
      "UPDATE matches SET status = 'proof_required' WHERE id = $1 AND status = 'active'",
      [matchId]
    );

    logUserActivity(userId, 'proof_upload', request.ip, `Proof for match #${matchId}`);

    return reply.redirect(`/matches/${matchId}`);
  });

  // POST /matches/:id/report - Report winner
  app.post('/:id/report', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const matchId = request.params.id;
    const userId = request.user.id;
    const { winner_id } = request.body;

    const matchResult = await pool.query(
      "SELECT * FROM matches WHERE id = $1 AND status IN ('active','proof_required')",
      [matchId]
    );

    if (matchResult.rows.length === 0) {
      return reply.code(400).send('Match not available for reporting');
    }

    const match = matchResult.rows[0];
    if (match.player1_id !== userId && match.player2_id !== userId) {
      return reply.code(403).send('Not a participant');
    }

    const winnerId = parseInt(winner_id);
    if (winnerId !== match.player1_id && winnerId !== match.player2_id) {
      return reply.code(400).send('Invalid winner');
    }

    // For MVP: if the reporter selects themselves, mark as disputed
    // If they select opponent, complete the match (honesty-based)
    const isHonest = winnerId !== userId;

    if (isHonest) {
      // Opponent reported as winner - complete the match
      const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
      const stake = parseFloat(match.stake_amount);
      const payout = stake * 2;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Complete match
        await client.query(
          "UPDATE matches SET status = 'completed', winner_id = $1, completed_at = NOW() WHERE id = $2",
          [winnerId, matchId]
        );

        // Pay winner
        await client.query(
          'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [payout, winnerId]
        );

        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description)
           VALUES ($1, 'win', $2, $3, $4)`,
          [winnerId, payout, matchId, 'Match win payout']
        );

        // Update ELO
        const winnerData = await client.query('SELECT elo_rating FROM users WHERE id = $1', [winnerId]);
        const loserData = await client.query('SELECT elo_rating FROM users WHERE id = $1', [loserId]);

        const { winnerNew, loserNew } = calculateElo(
          winnerData.rows[0].elo_rating,
          loserData.rows[0].elo_rating
        );

        await client.query('UPDATE users SET elo_rating = $1 WHERE id = $2', [winnerNew, winnerId]);
        await client.query('UPDATE users SET elo_rating = $1 WHERE id = $2', [loserNew, loserId]);

        // Update leaderboard
        const gameId = match.game_id;
        await client.query(
          `INSERT INTO leaderboard (user_id, game_id, elo, wins, win_streak)
           VALUES ($1, $2, $3, 1, 1)
           ON CONFLICT (user_id, game_id, season) DO UPDATE SET
             elo = $3, wins = leaderboard.wins + 1,
             win_streak = leaderboard.win_streak + 1`,
          [winnerId, gameId, winnerNew]
        );
        await client.query(
          `INSERT INTO leaderboard (user_id, game_id, elo, losses)
           VALUES ($1, $2, $3, 1)
           ON CONFLICT (user_id, game_id, season) DO UPDATE SET
             elo = $3, losses = leaderboard.losses + 1, win_streak = 0`,
          [loserId, gameId, loserNew]
        );

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      // Self-reported as winner - mark disputed
      await pool.query("UPDATE matches SET status = 'disputed' WHERE id = $1", [matchId]);
    }

    logUserActivity(userId, 'match_report', request.ip, `Match #${matchId}, reported winner: ${winnerId}`);

    return reply.redirect(`/matches/${matchId}`);
  });

  // POST /matches/:id/flag - Report a player in a match
  app.post('/:id/flag', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');
    if (app.checkActionRateLimit && !app.checkActionRateLimit(request, reply)) return;

    const matchId = parseInt(request.params.id);
    const userId = request.user.id;
    const { reported_user_id, reason, details } = request.body;

    const reportedId = parseInt(reported_user_id);
    if (!reportedId || reportedId === userId) {
      return reply.code(400).send('Invalid report');
    }

    // Scan report text for moderation
    const scan = scanContent(details || '');

    await pool.query(
      `INSERT INTO flags (type, match_id, user_id, reported_user_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [reason || 'player_report', matchId, userId, reportedId, details || 'No details provided']
    );

    // Auto-flag if content itself has issues
    for (const flag of scan.flags) {
      await pool.query(
        `INSERT INTO flags (type, match_id, user_id, reported_user_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [flag.type, matchId, userId, reportedId, flag.detail]
      );
    }

    return reply.redirect(`/matches/${matchId}`);
  });

  // GET /matches/:id - Match detail (participants and admins only, except waiting matches)
  app.get('/:id', async (request, reply) => {
    const matchId = request.params.id;

    const matchResult = await pool.query(
      `SELECT m.*, g.name as game_name, g.slug as game_slug, g.icon as game_icon,
              u1.username as player1_name, u1.display_name as player1_display, u1.elo_rating as player1_elo,
              u2.username as player2_name, u2.display_name as player2_display, u2.elo_rating as player2_elo,
              uw.username as winner_name
       FROM matches m
       JOIN games g ON m.game_id = g.id
       JOIN users u1 ON m.player1_id = u1.id
       LEFT JOIN users u2 ON m.player2_id = u2.id
       LEFT JOIN users uw ON m.winner_id = uw.id
       WHERE m.id = $1`,
      [matchId]
    );

    if (matchResult.rows.length === 0) {
      return reply.code(404).send('Match not found');
    }

    const match = matchResult.rows[0];

    // Allow anyone to see waiting matches (so opponents can join).
    // For all other statuses, restrict to participants and admins.
    if (match.status !== 'waiting') {
      if (!request.user) {
        return reply.redirect('/auth/login');
      }
      const isParticipant = request.user.id === match.player1_id || request.user.id === match.player2_id;
      const isAdmin = request.user.role === 'admin' || request.user.role === 'owner';
      if (!isParticipant && !isAdmin) {
        return reply.code(403).send('Access denied: you are not a participant in this match');
      }
    }

    const [proofsResult, cancellationResult] = await Promise.all([
      pool.query(
        `SELECT mp.*, u.username FROM match_proofs mp
         JOIN users u ON mp.user_id = u.id
         WHERE mp.match_id = $1 ORDER BY mp.submitted_at`,
        [matchId]
      ),
      pool.query(
        `SELECT mc.*, a.username as admin_username, wu.username as warned_username
         FROM match_cancellations mc
         JOIN users a ON mc.admin_id = a.id
         LEFT JOIN users wu ON mc.warned_user_id = wu.id
         WHERE mc.match_id = $1`,
        [matchId]
      ),
    ]);

    return reply.view('matches/detail.ejs', {
      user: request.user,
      match,
      proofs: proofsResult.rows,
      cancellation: cancellationResult.rows[0] || null,
    });
  });
}
