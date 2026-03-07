import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://duelstake_app:duelstake_pass@localhost:5432/stz_duelstake',
});

// Table definitions (used by migrate.js)
export const schema = {
  users: `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      username VARCHAR(50) NOT NULL UNIQUE,
      display_name VARCHAR(100),
      avatar_path VARCHAR(500),
      elo_rating INTEGER NOT NULL DEFAULT 1000,
      wallet_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      steam_id VARCHAR(100),
      discord_id VARCHAR(100),
      verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `,
  games: `
    CREATE TABLE IF NOT EXISTS games (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      icon VARCHAR(10),
      description TEXT,
      min_stake DECIMAL(10,2) NOT NULL DEFAULT 1,
      max_stake DECIMAL(10,2) NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT true
    )
  `,
  matches: `
    CREATE TABLE IF NOT EXISTS matches (
      id SERIAL PRIMARY KEY,
      game_id INTEGER NOT NULL REFERENCES games(id),
      player1_id INTEGER NOT NULL REFERENCES users(id),
      player2_id INTEGER REFERENCES users(id),
      stake_amount DECIMAL(10,2) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'waiting'
        CHECK (status IN ('waiting','active','proof_required','completed','disputed','cancelled')),
      winner_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      started_at TIMESTAMP WITH TIME ZONE,
      completed_at TIMESTAMP WITH TIME ZONE
    )
  `,
  match_proofs: `
    CREATE TABLE IF NOT EXISTS match_proofs (
      id SERIAL PRIMARY KEY,
      match_id INTEGER NOT NULL REFERENCES matches(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      file_path VARCHAR(500) NOT NULL,
      description TEXT,
      submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      review_status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (review_status IN ('pending','approved','rejected'))
    )
  `,
  leaderboard: `
    CREATE TABLE IF NOT EXISTS leaderboard (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      game_id INTEGER NOT NULL REFERENCES games(id),
      elo INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      win_streak INTEGER NOT NULL DEFAULT 0,
      season INTEGER NOT NULL DEFAULT 1,
      UNIQUE (user_id, game_id, season)
    )
  `,
  wallet_transactions: `
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type VARCHAR(20) NOT NULL
        CHECK (type IN ('deposit','withdrawal','stake','win','refund')),
      amount DECIMAL(12,2) NOT NULL,
      match_id INTEGER REFERENCES matches(id),
      description TEXT,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `,
};
