import { pool, schema } from './schema.js';

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');

    // Create tables in order (respecting foreign keys)
    for (const [name, sql] of Object.entries(schema)) {
      console.log(`  Creating table: ${name}`);
      await client.query(sql);
    }

    // Create indices
    console.log('  Creating indices...');

    await client.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_users_elo ON users(elo_rating DESC)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_games_slug ON games(slug)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_games_active ON games(active)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_game_id ON matches(game_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_player1 ON matches(player1_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_player2 ON matches(player2_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_matches_created ON matches(created_at DESC)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_match_proofs_match ON match_proofs(match_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_match_proofs_user ON match_proofs(user_id)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_leaderboard_game ON leaderboard(game_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leaderboard_elo ON leaderboard(elo DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_leaderboard_user ON leaderboard(user_id)');

    await client.query('CREATE INDEX IF NOT EXISTS idx_wallet_tx_user ON wallet_transactions(user_id)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wallet_tx_created ON wallet_transactions(created_at DESC)');
    await client.query('CREATE INDEX IF NOT EXISTS idx_wallet_tx_type ON wallet_transactions(type)');

    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
