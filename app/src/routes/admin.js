import { pool } from '../db/schema.js';

// Run admin migrations at startup
export async function runAdminMigrations() {
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`,
    `CREATE TABLE IF NOT EXISTS flags (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      match_id INTEGER,
      user_id INTEGER,
      reported_user_id INTEGER,
      details TEXT,
      status VARCHAR(20) DEFAULT 'pending',
      reviewed_by INTEGER,
      reviewed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS admin_log (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      action VARCHAR(100) NOT NULL,
      target_type VARCHAR(50),
      target_id INTEGER,
      details TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `UPDATE users SET role = 'owner' WHERE email = 'admin@stuzzicadenti.ch' AND role = 'user'`,

    // Warning system (Task 3)
    `CREATE TABLE IF NOT EXISTS user_warnings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      admin_id INTEGER NOT NULL REFERENCES users(id),
      reason VARCHAR(50) NOT NULL,
      details TEXT,
      evidence_url TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,

    // Match cancellations (Task 4)
    `CREATE TABLE IF NOT EXISTS match_cancellations (
      id SERIAL PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id),
      admin_id INTEGER NOT NULL REFERENCES users(id),
      reason VARCHAR(50) NOT NULL,
      details TEXT,
      evidence_url TEXT,
      warned_user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,

    // Anti-evasion IP tracking (Task 5)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip VARCHAR(45)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(45)`,

    // KYC (Task 7)
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status VARCHAR(20) DEFAULT 'none'`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_type VARCHAR(50)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_document_path VARCHAR(500)`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_verified_at TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_rejected_reason TEXT`,

    // User activity log (Task 8)
    `CREATE TABLE IF NOT EXISTS user_activity (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      action VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      details TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_user_activity_user_id ON user_activity(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_user_activity_created_at ON user_activity(created_at DESC)`,
    `ALTER TABLE user_warnings ADD COLUMN IF NOT EXISTS expired BOOLEAN DEFAULT false`,
    `CREATE INDEX IF NOT EXISTS idx_user_warnings_user_id ON user_warnings(user_id)`,
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
    } catch (err) {
      console.error('Migration error:', err.message);
    }
  }
  console.log('[admin] Migrations complete');
}

// Middleware: require admin or owner role
async function requireAdmin(request, reply) {
  if (!request.user) {
    return reply.redirect('/auth/login');
  }
  const result = await pool.query('SELECT role, banned FROM users WHERE id = $1', [request.user.id]);
  if (result.rows.length === 0 || result.rows[0].banned) {
    return reply.redirect('/');
  }
  const role = result.rows[0].role;
  if (role !== 'admin' && role !== 'owner') {
    return reply.code(403).send('Forbidden');
  }
  request.adminRole = role;
}

// Log admin action
async function logAction(adminId, action, targetType, targetId, details) {
  await pool.query(
    `INSERT INTO admin_log (admin_id, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [adminId, action, targetType, targetId, details]
  );
}

// Log user activity (Task 8)
export async function logUserActivity(userId, action, ipAddress, details) {
  try {
    await pool.query(
      `INSERT INTO user_activity (user_id, action, ip_address, details)
       VALUES ($1, $2, $3, $4)`,
      [userId, action, ipAddress || null, details || null]
    );
  } catch (err) {
    // Non-critical - don't break the flow
    console.error('[activity] Failed to log:', err.message);
  }
}

// Valid warning reasons
const WARNING_REASONS = ['cheating', 'toxicity', 'account_sharing', 'match_fixing', 'harassment', 'impersonation', 'exploit_abuse', 'other'];

// Valid cancellation reasons
const CANCEL_REASONS = ['cheating_confirmed', 'bug_exploit', 'connection_issues', 'player_dispute', 'rule_violation', 'match_fixing', 'other'];

export default async function adminRoutes(app) {
  // All admin routes require admin role
  app.addHook('preHandler', requireAdmin);

  // GET /admin - Dashboard
  app.get('/', async (request, reply) => {
    const [usersCount, activeMatches, totalStaked, pendingFlags, recentDisputes, revenue] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query("SELECT COUNT(*) as count FROM matches WHERE status IN ('waiting', 'active', 'proof_required')"),
      pool.query("SELECT COALESCE(SUM(stake_amount * 2), 0) as total FROM matches WHERE status = 'completed'"),
      pool.query("SELECT COUNT(*) as count FROM flags WHERE status = 'pending'"),
      pool.query(
        `SELECT m.*, g.name as game_name,
                u1.username as player1_name, u2.username as player2_name
         FROM matches m
         JOIN games g ON m.game_id = g.id
         JOIN users u1 ON m.player1_id = u1.id
         LEFT JOIN users u2 ON m.player2_id = u2.id
         WHERE m.status = 'disputed'
         ORDER BY m.created_at DESC LIMIT 10`
      ),
      pool.query(
        `SELECT COALESCE(SUM(stake_amount * 2 * 0.05), 0) as total
         FROM matches WHERE status = 'completed'`
      ),
    ]);

    const recentFlags = await pool.query(
      `SELECT f.*, u.username as reporter_name, ru.username as reported_name
       FROM flags f
       LEFT JOIN users u ON f.user_id = u.id
       LEFT JOIN users ru ON f.reported_user_id = ru.id
       WHERE f.status = 'pending'
       ORDER BY f.created_at DESC LIMIT 10`
    );

    return reply.view('admin/dashboard.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      stats: {
        totalUsers: usersCount.rows[0].count,
        activeMatches: activeMatches.rows[0].count,
        totalStaked: parseFloat(totalStaked.rows[0].total).toFixed(2),
        pendingFlags: pendingFlags.rows[0].count,
        revenue: parseFloat(revenue.rows[0].total).toFixed(2),
      },
      recentDisputes: recentDisputes.rows,
      recentFlags: recentFlags.rows,
    });
  });

  // GET /admin/users - User list
  app.get('/users', async (request, reply) => {
    const search = request.query.search || '';
    const roleFilter = request.query.role || '';
    const bannedFilter = request.query.banned || '';

    let where = 'WHERE 1=1';
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (u.username ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.display_name ILIKE $${params.length})`;
    }
    if (roleFilter) {
      params.push(roleFilter);
      where += ` AND u.role = $${params.length}`;
    }
    if (bannedFilter === 'true') {
      where += ' AND u.banned = true';
    } else if (bannedFilter === 'false') {
      where += ' AND (u.banned = false OR u.banned IS NULL)';
    }

    const users = await pool.query(
      `SELECT u.id, u.email, u.username, u.display_name, u.elo_rating, u.wallet_balance,
              u.role, u.verified, u.banned, u.banned_reason, u.banned_at, u.created_at,
              u.kyc_status,
              COALESCE(w.warning_count, 0)::int as warning_count
       FROM users u
       LEFT JOIN (SELECT user_id, COUNT(*) as warning_count FROM user_warnings GROUP BY user_id) w ON w.user_id = u.id
       ${where}
       ORDER BY u.created_at DESC LIMIT 100`,
      params
    );

    return reply.view('admin/users.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      users: users.rows,
      search,
      roleFilter,
      bannedFilter,
    });
  });

  // POST /admin/users/:id/role - Change user role
  app.post('/users/:id/role', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const { role } = request.body;

    if (!['user', 'admin', 'owner'].includes(role)) {
      return reply.code(400).send('Invalid role');
    }

    // Only owners can promote to admin/owner
    if ((role === 'admin' || role === 'owner') && request.adminRole !== 'owner') {
      return reply.code(403).send('Only owners can assign admin/owner roles');
    }

    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [role, targetId]);
    await logAction(request.user.id, 'change_role', 'user', targetId, `Set role to ${role}`);

    return reply.redirect('/admin/users');
  });

  // POST /admin/users/:id/ban - Ban user
  app.post('/users/:id/ban', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const { reason } = request.body;

    // Cannot ban yourself
    if (targetId === request.user.id) {
      return reply.code(400).send('Cannot ban yourself');
    }

    // Check target role - cannot ban owners
    const target = await pool.query('SELECT role FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return reply.code(404).send('User not found');
    if (target.rows[0].role === 'owner') return reply.code(403).send('Cannot ban an owner');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Ban user
      await client.query(
        `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW()
         WHERE id = $2`,
        [reason || 'Violated platform rules', targetId]
      );

      // Cancel active matches and refund stakes
      const activeMatches = await client.query(
        `SELECT id, player1_id, player2_id, stake_amount, status
         FROM matches
         WHERE (player1_id = $1 OR player2_id = $1)
           AND status IN ('waiting', 'active', 'proof_required')`,
        [targetId]
      );

      for (const match of activeMatches.rows) {
        const stake = parseFloat(match.stake_amount);

        // Refund player1
        await client.query(
          'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [stake, match.player1_id]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description)
           VALUES ($1, 'refund', $2, $3, 'Match cancelled - player banned')`,
          [match.player1_id, stake, match.id]
        );

        // Refund player2 if joined
        if (match.player2_id) {
          await client.query(
            'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
            [stake, match.player2_id]
          );
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description)
             VALUES ($1, 'refund', $2, $3, 'Match cancelled - player banned')`,
            [match.player2_id, stake, match.id]
          );
        }

        // Cancel match
        await client.query(
          "UPDATE matches SET status = 'cancelled', completed_at = NOW() WHERE id = $1",
          [match.id]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAction(request.user.id, 'ban_user', 'user', targetId, reason || 'No reason provided');
    return reply.redirect('/admin/users');
  });

  // POST /admin/users/:id/unban - Unban user
  app.post('/users/:id/unban', async (request, reply) => {
    const targetId = parseInt(request.params.id);

    await pool.query(
      'UPDATE users SET banned = false, banned_reason = NULL, banned_at = NULL WHERE id = $1',
      [targetId]
    );
    await logAction(request.user.id, 'unban_user', 'user', targetId, 'Unbanned');

    return reply.redirect('/admin/users');
  });

  // GET /admin/matches - All matches
  app.get('/matches', async (request, reply) => {
    const statusFilter = request.query.status || '';

    let where = '';
    const params = [];
    if (statusFilter) {
      params.push(statusFilter);
      where = `WHERE m.status = $${params.length}`;
    }

    const matches = await pool.query(
      `SELECT m.*, g.name as game_name, g.icon as game_icon,
              u1.username as player1_name, u2.username as player2_name,
              uw.username as winner_name
       FROM matches m
       JOIN games g ON m.game_id = g.id
       JOIN users u1 ON m.player1_id = u1.id
       LEFT JOIN users u2 ON m.player2_id = u2.id
       LEFT JOIN users uw ON m.winner_id = uw.id
       ${where}
       ORDER BY m.created_at DESC LIMIT 100`,
      params
    );

    return reply.view('admin/matches.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      matches: matches.rows,
      statusFilter,
    });
  });

  // POST /admin/matches/:id/resolve - Resolve disputed match
  app.post('/matches/:id/resolve', async (request, reply) => {
    const matchId = parseInt(request.params.id);
    const { winner_id, action, cancel_reason, cancel_details, cancel_evidence_url, warn_user_id } = request.body;

    const matchResult = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
    if (matchResult.rows.length === 0) return reply.code(404).send('Match not found');
    const match = matchResult.rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (action === 'cancel') {
        // Validate cancellation reason
        const reason = cancel_reason || 'other';
        if (!CANCEL_REASONS.includes(reason)) {
          return reply.code(400).send('Invalid cancellation reason');
        }

        // Cancel and refund both players
        const stake = parseFloat(match.stake_amount);

        await client.query(
          'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
          [stake, match.player1_id]
        );
        await client.query(
          `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description)
           VALUES ($1, 'refund', $2, $3, 'Match cancelled by admin')`,
          [match.player1_id, stake, matchId]
        );

        if (match.player2_id) {
          await client.query(
            'UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2',
            [stake, match.player2_id]
          );
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description)
             VALUES ($1, 'refund', $2, $3, 'Match cancelled by admin')`,
            [match.player2_id, stake, matchId]
          );
        }

        await client.query(
          "UPDATE matches SET status = 'cancelled', completed_at = NOW() WHERE id = $1",
          [matchId]
        );

        // Store cancellation details
        let warnedUserId = null;
        if (reason === 'cheating_confirmed' && warn_user_id) {
          warnedUserId = parseInt(warn_user_id);
          // Issue a warning to the cheater
          await client.query(
            `INSERT INTO user_warnings (user_id, admin_id, reason, details, evidence_url)
             VALUES ($1, $2, 'cheating', $3, $4)`,
            [warnedUserId, request.user.id, cancel_details || 'Cheating confirmed in match #' + matchId, cancel_evidence_url || null]
          );
          // Check if 3 warnings => auto-ban
          const warnCount = await client.query(
            'SELECT COUNT(*) as count FROM user_warnings WHERE user_id = $1',
            [warnedUserId]
          );
          if (parseInt(warnCount.rows[0].count) >= 3) {
            await client.query(
              `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW() WHERE id = $2`,
              ['Automatically banned: 3 warnings reached', warnedUserId]
            );
            await logAction(request.user.id, 'auto_ban_warnings', 'user', warnedUserId, '3 warnings reached');
          }
        }

        await client.query(
          `INSERT INTO match_cancellations (match_id, admin_id, reason, details, evidence_url, warned_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [matchId, request.user.id, reason, cancel_details || null, cancel_evidence_url || null, warnedUserId]
        );

        await logAction(request.user.id, 'cancel_match', 'match', matchId, `Reason: ${reason}. ${cancel_details || ''}`);
      } else if (action === 'set_winner' && winner_id) {
        const winnerId = parseInt(winner_id);
        const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
        const stake = parseFloat(match.stake_amount);
        const payout = stake * 2;

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
           VALUES ($1, 'win', $2, $3, 'Match resolved by admin')`,
          [winnerId, payout, matchId]
        );

        // Import and use elo calculation
        const { calculateElo } = await import('../utils/elo.js');
        const winnerData = await client.query('SELECT elo_rating FROM users WHERE id = $1', [winnerId]);
        const loserData = await client.query('SELECT elo_rating FROM users WHERE id = $1', [loserId]);
        const { winnerNew, loserNew } = calculateElo(winnerData.rows[0].elo_rating, loserData.rows[0].elo_rating);
        await client.query('UPDATE users SET elo_rating = $1 WHERE id = $2', [winnerNew, winnerId]);
        await client.query('UPDATE users SET elo_rating = $1 WHERE id = $2', [loserNew, loserId]);

        await logAction(request.user.id, 'resolve_match', 'match', matchId, `Winner: user ${winnerId}`);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return reply.redirect('/admin/matches');
  });

  // GET /admin/flags - Flag queue
  app.get('/flags', async (request, reply) => {
    const statusFilter = request.query.status || 'pending';

    const flags = await pool.query(
      `SELECT f.*,
              u.username as reporter_name,
              ru.username as reported_name,
              au.username as reviewer_name
       FROM flags f
       LEFT JOIN users u ON f.user_id = u.id
       LEFT JOIN users ru ON f.reported_user_id = ru.id
       LEFT JOIN users au ON f.reviewed_by = au.id
       WHERE f.status = $1
       ORDER BY f.created_at DESC LIMIT 100`,
      [statusFilter]
    );

    return reply.view('admin/flags.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      flags: flags.rows,
      statusFilter,
    });
  });

  // POST /admin/flags/:id/dismiss - Dismiss flag
  app.post('/flags/:id/dismiss', async (request, reply) => {
    const flagId = parseInt(request.params.id);

    await pool.query(
      `UPDATE flags SET status = 'dismissed', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [request.user.id, flagId]
    );
    await logAction(request.user.id, 'dismiss_flag', 'flag', flagId, 'Dismissed');

    return reply.redirect('/admin/flags');
  });

  // POST /admin/flags/:id/action - Take action on flag
  app.post('/flags/:id/action', async (request, reply) => {
    const flagId = parseInt(request.params.id);
    const { action_type, ban_reason } = request.body;

    const flag = await pool.query('SELECT * FROM flags WHERE id = $1', [flagId]);
    if (flag.rows.length === 0) return reply.code(404).send('Flag not found');
    const f = flag.rows[0];

    // Mark flag as actioned
    await pool.query(
      `UPDATE flags SET status = 'actioned', reviewed_by = $1, reviewed_at = NOW()
       WHERE id = $2`,
      [request.user.id, flagId]
    );

    if (action_type === 'warn' && f.reported_user_id) {
      // Issue a warning from flag
      const warnReason = request.body.warn_reason || 'other';
      if (WARNING_REASONS.includes(warnReason)) {
        const target = await pool.query('SELECT role, banned FROM users WHERE id = $1', [f.reported_user_id]);
        if (target.rows.length > 0 && target.rows[0].role !== 'owner') {
          await pool.query(
            `INSERT INTO user_warnings (user_id, admin_id, reason, details)
             VALUES ($1, $2, $3, $4)`,
            [f.reported_user_id, request.user.id, warnReason, `From flag #${flagId}: ${f.details || ''}`]
          );
          // Check 3-warning auto-ban
          const warnCount = await pool.query('SELECT COUNT(*) as count FROM user_warnings WHERE user_id = $1', [f.reported_user_id]);
          if (parseInt(warnCount.rows[0].count) >= 3 && !target.rows[0].banned) {
            await pool.query(
              `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW() WHERE id = $2`,
              ['Automatically banned: 3 warnings reached', f.reported_user_id]
            );
            await logAction(request.user.id, 'auto_ban_warnings', 'user', f.reported_user_id, '3 warnings reached');
          }
          await logAction(request.user.id, 'warn_from_flag', 'user', f.reported_user_id, `Flag #${flagId}: ${warnReason}`);
        }
      }
    } else if (action_type === 'ban' && f.reported_user_id) {
      // Ban the reported user via the ban route logic
      const target = await pool.query('SELECT role FROM users WHERE id = $1', [f.reported_user_id]);
      if (target.rows.length > 0 && target.rows[0].role !== 'owner') {
        // Simplified ban - just set the flag, the full ban with match cancellation
        // happens when admin uses the ban button on the user page
        await pool.query(
          `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW()
           WHERE id = $2`,
          [ban_reason || 'Flagged and banned by admin', f.reported_user_id]
        );
        await logAction(request.user.id, 'ban_from_flag', 'user', f.reported_user_id, `Flag #${flagId}: ${ban_reason || 'No reason'}`);
      }
    } else if (action_type === 'cancel_match' && f.match_id) {
      // Cancel the flagged match
      const match = await pool.query("SELECT * FROM matches WHERE id = $1 AND status NOT IN ('completed', 'cancelled')", [f.match_id]);
      if (match.rows.length > 0) {
        const m = match.rows[0];
        const stake = parseFloat(m.stake_amount);
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [stake, m.player1_id]);
          await client.query(
            `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description) VALUES ($1, 'refund', $2, $3, 'Match cancelled from flag')`,
            [m.player1_id, stake, f.match_id]
          );
          if (m.player2_id) {
            await client.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id = $2', [stake, m.player2_id]);
            await client.query(
              `INSERT INTO wallet_transactions (user_id, type, amount, match_id, description) VALUES ($1, 'refund', $2, $3, 'Match cancelled from flag')`,
              [m.player2_id, stake, f.match_id]
            );
          }
          await client.query("UPDATE matches SET status = 'cancelled', completed_at = NOW() WHERE id = $1", [f.match_id]);
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        } finally {
          client.release();
        }
        await logAction(request.user.id, 'cancel_match_from_flag', 'match', f.match_id, `Flag #${flagId}`);
      }
    }

    await logAction(request.user.id, 'action_flag', 'flag', flagId, `Action: ${action_type}`);
    return reply.redirect('/admin/flags');
  });

  // GET /admin/logs - Activity log
  app.get('/logs', async (request, reply) => {
    const logs = await pool.query(
      `SELECT al.*, u.username as admin_name
       FROM admin_log al
       JOIN users u ON al.admin_id = u.id
       ORDER BY al.created_at DESC LIMIT 200`
    );

    return reply.view('admin/logs.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      logs: logs.rows,
    });
  });

  // TASK 3: Warning System

  // POST /admin/users/:id/warn - Issue a warning
  app.post('/users/:id/warn', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const { reason, details, evidence_url } = request.body;

    if (!WARNING_REASONS.includes(reason)) {
      return reply.code(400).send('Invalid warning reason');
    }

    // Cannot warn yourself
    if (targetId === request.user.id) {
      return reply.code(400).send('Cannot warn yourself');
    }

    const target = await pool.query('SELECT id, role, banned FROM users WHERE id = $1', [targetId]);
    if (target.rows.length === 0) return reply.code(404).send('User not found');
    if (target.rows[0].role === 'owner') return reply.code(403).send('Cannot warn an owner');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `INSERT INTO user_warnings (user_id, admin_id, reason, details, evidence_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetId, request.user.id, reason, details || null, evidence_url || null]
      );

      // Expire old warnings (6+ months of good conduct)
      await client.query(
        `UPDATE user_warnings SET expired = true
         WHERE user_id = $1 AND expired = false
           AND created_at < NOW() - INTERVAL '6 months'`,
        [targetId]
      );

      // Check if 3 active warnings => auto-ban
      const warnCount = await client.query(
        'SELECT COUNT(*) as count FROM user_warnings WHERE user_id = $1 AND expired = false',
        [targetId]
      );

      if (parseInt(warnCount.rows[0].count) >= 3 && !target.rows[0].banned) {
        await client.query(
          `UPDATE users SET banned = true, banned_reason = $1, banned_at = NOW() WHERE id = $2`,
          ['Account suspended: 3 active warnings for misconduct', targetId]
        );
        await logAction(request.user.id, 'auto_ban_warnings', 'user', targetId, '3 active warnings reached');
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    await logAction(request.user.id, 'warn_user', 'user', targetId, `Reason: ${reason}. ${details || ''}`);
    return reply.redirect('/admin/users');
  });

  // TASK 6: Admin User Transaction View

  // GET /admin/users/:id/transactions - View user's wallet transactions
  app.get('/users/:id/transactions', async (request, reply) => {
    const targetId = parseInt(request.params.id);

    const [userResult, transactions, totals] = await Promise.all([
      pool.query(
        'SELECT id, username, display_name, email, wallet_balance, kyc_status FROM users WHERE id = $1',
        [targetId]
      ),
      pool.query(
        `SELECT * FROM wallet_transactions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [targetId]
      ),
      pool.query(
        `SELECT type, COALESCE(SUM(ABS(amount)), 0) as total
         FROM wallet_transactions
         WHERE user_id = $1
         GROUP BY type`,
        [targetId]
      ),
    ]);

    if (userResult.rows.length === 0) return reply.code(404).send('User not found');

    const totalsByType = {};
    totals.rows.forEach(r => { totalsByType[r.type] = parseFloat(r.total); });

    return reply.view('admin/user-transactions.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      targetUser: userResult.rows[0],
      transactions: transactions.rows,
      totalsByType,
    });
  });

  // TASK 8: User Activity Log

  // GET /admin/users/:id/activity - View user's activity log
  app.get('/users/:id/activity', async (request, reply) => {
    const targetId = parseInt(request.params.id);

    const [userResult, activities] = await Promise.all([
      pool.query('SELECT id, username, display_name, email FROM users WHERE id = $1', [targetId]),
      pool.query(
        `SELECT * FROM user_activity
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 200`,
        [targetId]
      ),
    ]);

    if (userResult.rows.length === 0) return reply.code(404).send('User not found');

    return reply.view('admin/user-activity.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      targetUser: userResult.rows[0],
      activities: activities.rows,
    });
  });

  // TASK 7: KYC Admin Queue

  // GET /admin/kyc - KYC verification queue
  app.get('/kyc', async (request, reply) => {
    const statusFilter = request.query.status || 'pending';

    const submissions = await pool.query(
      `SELECT id, username, display_name, email, kyc_status, kyc_document_type,
              kyc_document_path, kyc_submitted_at, kyc_verified_at, kyc_rejected_reason
       FROM users
       WHERE kyc_status = $1
       ORDER BY kyc_submitted_at ASC
       LIMIT 100`,
      [statusFilter]
    );

    return reply.view('admin/kyc.ejs', {
      user: request.user,
      adminRole: request.adminRole,
      submissions: submissions.rows,
      statusFilter,
    });
  });

  // POST /admin/kyc/:id/approve - Approve KYC
  app.post('/kyc/:id/approve', async (request, reply) => {
    const targetId = parseInt(request.params.id);

    await pool.query(
      `UPDATE users SET kyc_status = 'verified', kyc_verified_at = NOW(), kyc_rejected_reason = NULL
       WHERE id = $1`,
      [targetId]
    );
    await logAction(request.user.id, 'approve_kyc', 'user', targetId, 'KYC approved');

    return reply.redirect('/admin/kyc');
  });

  // POST /admin/kyc/:id/reject - Reject KYC
  app.post('/kyc/:id/reject', async (request, reply) => {
    const targetId = parseInt(request.params.id);
    const { reason } = request.body;

    await pool.query(
      `UPDATE users SET kyc_status = 'rejected', kyc_rejected_reason = $1
       WHERE id = $2`,
      [reason || 'Document not acceptable', targetId]
    );
    await logAction(request.user.id, 'reject_kyc', 'user', targetId, reason || 'Document not acceptable');

    return reply.redirect('/admin/kyc');
  });
}
