import { pool } from '../db/schema.js';

export default async function leaderboardRoutes(app) {
  // GET /leaderboard - Global leaderboard
  app.get('/', async (request, reply) => {
    const topPlayers = await pool.query(
      `SELECT u.username, u.display_name, u.avatar_path, u.elo_rating,
              COALESCE(SUM(l.wins), 0) as total_wins,
              COALESCE(SUM(l.losses), 0) as total_losses,
              MAX(l.win_streak) as best_streak
       FROM users u
       LEFT JOIN leaderboard l ON u.id = l.user_id
       GROUP BY u.id
       ORDER BY u.elo_rating DESC
       LIMIT 50`
    );

    const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');

    return reply.view('leaderboard/index.ejs', {
      user: request.user,
      players: topPlayers.rows,
      games: games.rows,
      currentGame: null,
    });
  });

  // GET /leaderboard/:gameSlug - Per-game leaderboard
  app.get('/:gameSlug', async (request, reply) => {
    const { gameSlug } = request.params;

    const gameResult = await pool.query('SELECT * FROM games WHERE slug = $1', [gameSlug]);
    if (gameResult.rows.length === 0) {
      return reply.code(404).send('Game not found');
    }

    const game = gameResult.rows[0];

    const topPlayers = await pool.query(
      `SELECT u.username, u.display_name, u.avatar_path,
              l.elo, l.wins, l.losses, l.win_streak
       FROM leaderboard l
       JOIN users u ON l.user_id = u.id
       WHERE l.game_id = $1
       ORDER BY l.elo DESC
       LIMIT 50`,
      [game.id]
    );

    const games = await pool.query('SELECT * FROM games WHERE active = true ORDER BY name');

    return reply.view('leaderboard/game.ejs', {
      user: request.user,
      players: topPlayers.rows,
      games: games.rows,
      currentGame: game,
    });
  });
}
