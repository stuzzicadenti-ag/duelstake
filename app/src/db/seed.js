import { pool } from './schema.js';

const games = [
  { name: 'FIFA 26', slug: 'fifa-26', icon: '\u26BD', description: 'The beautiful game. Prove your skills on the virtual pitch in 1v1 matches.', min_stake: 1, max_stake: 500 },
  { name: 'Call of Duty', slug: 'call-of-duty', icon: '\uD83D\uDCA3', description: 'Tactical FPS showdowns. Outgun your opponent in intense 1v1 battles.', min_stake: 1, max_stake: 1000 },
  { name: 'Fortnite', slug: 'fortnite', icon: '\u26CF', description: 'Build, fight, survive. Last one standing wins the stake.', min_stake: 1, max_stake: 300 },
  { name: 'Valorant', slug: 'valorant', icon: '\uD83C\uDFAF', description: 'Precision aim meets tactical gameplay. Prove your worth in ranked 1v1s.', min_stake: 2, max_stake: 500 },
  { name: 'Rocket League', slug: 'rocket-league', icon: '\uD83D\uDE97', description: 'Rocket-powered car soccer. Aerial goals and clutch saves decide the winner.', min_stake: 1, max_stake: 200 },
  { name: 'Chess', slug: 'chess', icon: '\u265F', description: 'The ultimate strategy game. Outsmart your opponent move by move.', min_stake: 1, max_stake: 100 },
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding games...');
    for (const game of games) {
      await client.query(
        `INSERT INTO games (name, slug, icon, description, min_stake, max_stake)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           description = EXCLUDED.description,
           min_stake = EXCLUDED.min_stake,
           max_stake = EXCLUDED.max_stake`,
        [game.name, game.slug, game.icon, game.description, game.min_stake, game.max_stake]
      );
      console.log(`  Seeded: ${game.icon} ${game.name}`);
    }
    console.log('Seeding complete.');
  } catch (err) {
    console.error('Seeding failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
