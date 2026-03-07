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

## Tech Stack

- **Runtime**: Node.js (ESM)
- **Framework**: Fastify 5
- **Template Engine**: EJS
- **Database**: PostgreSQL (raw pg Pool)
- **Auth**: JWT cookies + bcryptjs (12 rounds)
- **Real-time**: WebSocket (@fastify/websocket)
- **File Uploads**: @fastify/multipart

## License

Proprietary -- Stuzzicadenti AG
