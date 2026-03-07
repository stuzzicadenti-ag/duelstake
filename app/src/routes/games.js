import { pool } from '../db/schema.js';

export default async function gamesRoutes(app) {
  // GET /games - List all active games
  app.get('/', async (request, reply) => {
    const gamesResult = await pool.query(
      'SELECT * FROM games WHERE active = true ORDER BY name'
    );

    // Get player counts per game (users with active/waiting matches)
    const playerCounts = await pool.query(
      `SELECT g.id as game_id, COUNT(DISTINCT CASE WHEN m.status IN ('waiting','active') THEN m.player1_id END)
       + COUNT(DISTINCT CASE WHEN m.status IN ('waiting','active') THEN m.player2_id END) as player_count
       FROM games g LEFT JOIN matches m ON g.id = m.game_id
       GROUP BY g.id`
    );

    const countMap = {};
    for (const row of playerCounts.rows) {
      countMap[row.game_id] = parseInt(row.player_count) || 0;
    }

    const games = gamesResult.rows.map(g => ({
      ...g,
      player_count: countMap[g.id] || 0,
    }));

    return reply.view('games/list.ejs', { user: request.user, games });
  });

  // GET /games/:slug - Game detail
  app.get('/:slug', async (request, reply) => {
    const { slug } = request.params;

    const gameResult = await pool.query('SELECT * FROM games WHERE slug = $1', [slug]);
    if (gameResult.rows.length === 0) {
      return reply.code(404).send('Game not found');
    }

    const game = gameResult.rows[0];

    const [recentMatches, topPlayers, waitingMatches] = await Promise.all([
      pool.query(
        `SELECT m.*, u1.username as player1_name, u2.username as player2_name,
                uw.username as winner_name
         FROM matches m
         JOIN users u1 ON m.player1_id = u1.id
         LEFT JOIN users u2 ON m.player2_id = u2.id
         LEFT JOIN users uw ON m.winner_id = uw.id
         WHERE m.game_id = $1
         ORDER BY m.created_at DESC LIMIT 10`,
        [game.id]
      ),
      pool.query(
        `SELECT u.username, u.display_name, u.avatar_path, l.elo, l.wins, l.losses, l.win_streak
         FROM leaderboard l
         JOIN users u ON l.user_id = u.id
         WHERE l.game_id = $1
         ORDER BY l.elo DESC LIMIT 10`,
        [game.id]
      ),
      pool.query(
        `SELECT m.*, u1.username as player1_name
         FROM matches m
         JOIN users u1 ON m.player1_id = u1.id
         WHERE m.game_id = $1 AND m.status = 'waiting'
         ORDER BY m.created_at DESC LIMIT 10`,
        [game.id]
      ),
    ]);

    return reply.view('games/detail.ejs', {
      user: request.user,
      game,
      recentMatches: recentMatches.rows,
      topPlayers: topPlayers.rows,
      waitingMatches: waitingMatches.rows,
    });
  });
}
