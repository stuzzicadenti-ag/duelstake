import { pool } from '../db/schema.js';
import { scanContent } from '../utils/moderation.js';

export default async function profileRoutes(app) {
  // POST /profile/:id/report - Report a user
  app.post('/:id/report', async (request, reply) => {
    if (!request.user) return reply.redirect('/auth/login');

    const reportedId = parseInt(request.params.id);
    const userId = request.user.id;

    if (reportedId === userId) {
      return reply.code(400).send('Cannot report yourself');
    }

    const { reason, details } = request.body;

    // Look up reported user's username for redirect
    const reportedUser = await pool.query('SELECT username FROM users WHERE id = $1', [reportedId]);
    if (reportedUser.rows.length === 0) return reply.code(404).send('User not found');

    // Scan content
    const scan = scanContent(details || '');

    await pool.query(
      `INSERT INTO flags (type, user_id, reported_user_id, details)
       VALUES ($1, $2, $3, $4)`,
      [reason || 'player_report', userId, reportedId, details || 'No details provided']
    );

    for (const flag of scan.flags) {
      await pool.query(
        `INSERT INTO flags (type, user_id, reported_user_id, details)
         VALUES ($1, $2, $3, $4)`,
        [flag.type, userId, reportedId, flag.detail]
      );
    }

    return reply.redirect(`/profile/${reportedUser.rows[0].username}`);
  });

  // GET /profile/:username - Public profile
  app.get('/:username', async (request, reply) => {
    const { username } = request.params;

    const userResult = await pool.query(
      `SELECT id, username, display_name, avatar_path, elo_rating, wallet_balance,
              steam_id, discord_id, created_at
       FROM users WHERE username = $1`,
      [username.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return reply.code(404).send('User not found');
    }

    const profile = userResult.rows[0];

    // Parallel queries for game stats, recent matches, and overall stats
    const [gameStats, recentMatches, overallStats] = await Promise.all([
      pool.query(
        `SELECT g.name, g.icon, g.slug, l.elo, l.wins, l.losses, l.win_streak
         FROM leaderboard l
         JOIN games g ON l.game_id = g.id
         WHERE l.user_id = $1
         ORDER BY l.elo DESC`,
        [profile.id]
      ),
      pool.query(
        `SELECT m.*, g.name as game_name, g.icon as game_icon,
                u1.username as player1_name, u2.username as player2_name,
                uw.username as winner_name
         FROM matches m
         JOIN games g ON m.game_id = g.id
         JOIN users u1 ON m.player1_id = u1.id
         LEFT JOIN users u2 ON m.player2_id = u2.id
         LEFT JOIN users uw ON m.winner_id = uw.id
         WHERE (m.player1_id = $1 OR m.player2_id = $1)
           AND m.status = 'completed'
         ORDER BY m.completed_at DESC LIMIT 10`,
        [profile.id]
      ),
      pool.query(
        `SELECT COALESCE(SUM(wins), 0) as total_wins,
                COALESCE(SUM(losses), 0) as total_losses
         FROM leaderboard WHERE user_id = $1`,
        [profile.id]
      ),
    ]);

    return reply.view('profile/view.ejs', {
      user: request.user,
      profile,
      gameStats: gameStats.rows,
      recentMatches: recentMatches.rows,
      totalWins: parseInt(overallStats.rows[0].total_wins),
      totalLosses: parseInt(overallStats.rows[0].total_losses),
    });
  });
}
