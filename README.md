# DuelStake

Skill-based competitive gaming platform where players compete in 1v1 matches with monetary stakes. Players create matches, set a stake, and the winner takes the pot minus a 5% platform commission. Features ELO ranking, per-game leaderboards, proof-based dispute resolution, and a comprehensive admin dashboard.

## Quick Start

```bash
cd app
npm install
# Set environment variables (see below)
npm run migrate
npm run seed
npm start
```

### Environment Variables

| Variable      | Description                 | Default |
|--------------|-----------------------------|---------|
| PORT         | Server port                  | 4004    |
| DATABASE_URL | PostgreSQL connection string | postgresql://duelstake_app:duelstake_pass@localhost:5432/stz_duelstake |
| JWT_SECRET   | JWT signing secret           | change-me |
| COOKIE_SECRET| Cookie signing secret        | change-me |
| UPLOAD_DIR   | Proof upload directory       | ./data/uploads |

## Documentation

See [DOCS.md](DOCS.md) for full technical documentation, architecture, database schema, API routes, legal compliance, and deployment details.

## Features

- **1v1 matches**: Create/join matches with monetary stakes (CHF 1-500)
- **ELO rating system**: K=32, starting 1000, separate per game
- **Per-game leaderboards**: Seasonal rankings with win/loss tracking
- **Digital wallet**: Deposit, withdraw, stake, win, refund with pessimistic locking
- **5% platform commission**: Deducted from winner payouts
- **Proof-based disputes**: Screenshot upload for result verification
- **Real-time updates**: WebSocket for live match status
- **Warning system**: 3 strikes = auto-ban, 6-month expiry
- **Admin panel**: Dashboard, user/match/dispute management, warnings, audit logs
- **i18n**: English, Italian, German, French with language dropdown
- **Responsive nav**: Profile dropdown, language dropdown, dark gaming theme
- **Legal**: Skill-based competition (not gambling), Swiss law, 18+ requirement

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Fastify 5
- **Template Engine**: EJS
- **Database**: PostgreSQL (raw pg Pool, FOR UPDATE locks)
- **Auth**: JWT cookies + bcryptjs (12 rounds)
- **Real-time**: WebSocket (@fastify/websocket)
- **File Uploads**: @fastify/multipart
- **i18n**: Flat JSON locale files (en, it, de, fr)
- **Theme**: Dark (bg: #0a0a0f, primary: #e63946, accent: #ffd700)

## License

Proprietary -- Stuzzicadenti AG
