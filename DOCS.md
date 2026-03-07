# DuelStake -- Technical Documentation

## Overview

DuelStake is a skill-based competitive gaming platform where players compete in 1v1 matches with monetary stakes. Similar to FaceIt or ESEA, players create matches for specific games, set a stake amount, and compete head-to-head. The winner takes the combined pot minus a 5% platform commission. The platform features ELO-based ranking, per-game leaderboards, proof-based dispute resolution, and a comprehensive admin dashboard.

**Target market:** Competitive gamers in Switzerland and Europe who want to play for real stakes.
**Value proposition:** Skill-based competition (not gambling), transparent ELO ranking, secure escrow-style wallet, fair dispute resolution.

## Architecture

```
Client (Browser)
    |
    v
Caddy (reverse proxy, port 80, .local domain)
    |
    v
Fastify (port 4004)
    |
    +---> PostgreSQL (stz_duelstake)
    |
    +---> WebSocket (/ws) for live match updates
```

### Request flow

1. Client sends HTTP request to Caddy reverse proxy
2. Caddy forwards to Fastify on port 4004
3. Fastify middleware chain: cookie parse -> JWT verify -> banned check -> route handler
4. Route handler queries PostgreSQL via raw `pg` Pool (parameterized queries)
5. EJS template rendered server-side and returned to client
6. WebSocket connection maintained for real-time match updates

### Directory structure

```
duelstake/
  app/
    src/
      server.js              # Fastify app, plugins, hooks, homepage
      db/
        schema.js            # Table definitions + pg Pool
        migrate.js           # Schema migration runner
        seed.js              # Seed data (games, test users)
      routes/
        auth.js              # Register, login, logout
        games.js             # Game listing, game detail
        matches.js           # Create, join, proof upload, report, flag
        leaderboard.js       # Global + per-game leaderboard
        wallet.js            # Deposit, withdraw, balance, history
        profile.js           # Public profile, report user
        admin.js             # Dashboard, users, matches, flags, logs
        ws.js                # WebSocket handler
      utils/
        elo.js               # ELO rating calculation
        moderation.js        # Content scanner (phone, email, threats, profanity)
      views/                 # EJS templates
      public/                # Static assets (CSS, JS, images)
    package.json
```

## Tech Stack

| Component        | Technology                                    |
|-----------------|----------------------------------------------|
| Runtime         | Node.js (ESM)                                 |
| Framework       | Fastify 5                                      |
| Template Engine | EJS via @fastify/view                          |
| Database        | PostgreSQL (raw pg Pool, parameterized queries)|
| Auth            | JWT (jsonwebtoken) in httpOnly cookies          |
| Password Hash   | bcryptjs (12 rounds)                            |
| WebSocket       | @fastify/websocket                              |
| File Uploads    | @fastify/multipart (10 MB limit)                |
| Static Files    | @fastify/static                                 |

### Dependencies

- `fastify` ^5.0.0
- `@fastify/static` ^8.0.0
- `@fastify/formbody` ^8.0.0
- `@fastify/cookie` ^11.0.0
- `@fastify/view` ^10.0.0
- `@fastify/websocket` ^11.0.0
- `@fastify/multipart` ^9.0.0
- `ejs` ^3.1.10
- `pg` ^8.13.0
- `bcryptjs` ^2.4.3
- `jsonwebtoken` ^9.0.2
- `ioredis` ^5.4.0 (declared but not actively used in current code)

## Database Schema

### Tables

#### users
| Column         | Type           | Constraints                  |
|---------------|----------------|------------------------------|
| id            | SERIAL         | PRIMARY KEY                   |
| email         | VARCHAR(255)   | NOT NULL, UNIQUE              |
| password_hash | VARCHAR(255)   | NOT NULL                      |
| username      | VARCHAR(50)    | NOT NULL, UNIQUE              |
| display_name  | VARCHAR(100)   |                               |
| avatar_path   | VARCHAR(500)   |                               |
| elo_rating    | INTEGER        | NOT NULL, DEFAULT 1000        |
| wallet_balance| DECIMAL(12,2)  | NOT NULL, DEFAULT 0           |
| steam_id      | VARCHAR(100)   |                               |
| discord_id    | VARCHAR(100)   |                               |
| verified      | BOOLEAN        | NOT NULL, DEFAULT false       |
| role          | VARCHAR(20)    | DEFAULT 'user'                |
| banned        | BOOLEAN        | DEFAULT false                 |
| banned_reason | TEXT           |                               |
| banned_at     | TIMESTAMP      |                               |
| created_at    | TIMESTAMPTZ    | NOT NULL, DEFAULT NOW()       |

#### games
| Column      | Type          | Constraints                    |
|------------|---------------|--------------------------------|
| id         | SERIAL        | PRIMARY KEY                     |
| name       | VARCHAR(100)  | NOT NULL                        |
| slug       | VARCHAR(100)  | NOT NULL, UNIQUE                |
| icon       | VARCHAR(10)   |                                 |
| description| TEXT          |                                 |
| min_stake  | DECIMAL(10,2) | NOT NULL, DEFAULT 1             |
| max_stake  | DECIMAL(10,2) | NOT NULL, DEFAULT 100           |
| active     | BOOLEAN       | NOT NULL, DEFAULT true          |

#### matches
| Column       | Type          | Constraints                                                          |
|-------------|---------------|----------------------------------------------------------------------|
| id          | SERIAL        | PRIMARY KEY                                                           |
| game_id     | INTEGER       | NOT NULL, FK -> games(id)                                             |
| player1_id  | INTEGER       | NOT NULL, FK -> users(id)                                             |
| player2_id  | INTEGER       | FK -> users(id)                                                       |
| stake_amount| DECIMAL(10,2) | NOT NULL                                                              |
| status      | VARCHAR(20)   | NOT NULL, DEFAULT 'waiting', CHECK IN (waiting,active,proof_required,completed,disputed,cancelled) |
| winner_id   | INTEGER       | FK -> users(id)                                                       |
| created_at  | TIMESTAMPTZ   | NOT NULL, DEFAULT NOW()                                               |
| started_at  | TIMESTAMPTZ   |                                                                       |
| completed_at| TIMESTAMPTZ   |                                                                       |

#### match_proofs
| Column        | Type          | Constraints                  |
|--------------|---------------|------------------------------|
| id           | SERIAL        | PRIMARY KEY                   |
| match_id     | INTEGER       | NOT NULL, FK -> matches(id)   |
| user_id      | INTEGER       | NOT NULL, FK -> users(id)     |
| file_path    | VARCHAR(500)  | NOT NULL                      |
| description  | TEXT          |                               |
| submitted_at | TIMESTAMPTZ   | NOT NULL, DEFAULT NOW()       |
| review_status| VARCHAR(20)   | NOT NULL, DEFAULT 'pending', CHECK IN (pending,approved,rejected) |

#### leaderboard
| Column     | Type    | Constraints                                |
|-----------|---------|-------------------------------------------|
| id        | SERIAL  | PRIMARY KEY                                |
| user_id   | INTEGER | NOT NULL, FK -> users(id)                  |
| game_id   | INTEGER | NOT NULL, FK -> games(id)                  |
| elo       | INTEGER | NOT NULL, DEFAULT 1000                     |
| wins      | INTEGER | NOT NULL, DEFAULT 0                        |
| losses    | INTEGER | NOT NULL, DEFAULT 0                        |
| win_streak| INTEGER | NOT NULL, DEFAULT 0                        |
| season    | INTEGER | NOT NULL, DEFAULT 1                        |
|           |         | UNIQUE (user_id, game_id, season)          |

#### wallet_transactions
| Column      | Type          | Constraints                                         |
|------------|---------------|-----------------------------------------------------|
| id         | SERIAL        | PRIMARY KEY                                          |
| user_id    | INTEGER       | NOT NULL, FK -> users(id)                            |
| type       | VARCHAR(20)   | NOT NULL, CHECK IN (deposit,withdrawal,stake,win,refund) |
| amount     | DECIMAL(12,2) | NOT NULL                                             |
| match_id   | INTEGER       | FK -> matches(id)                                    |
| description| TEXT          |                                                      |
| created_at | TIMESTAMPTZ   | NOT NULL, DEFAULT NOW()                              |

#### flags
| Column           | Type         | Constraints            |
|-----------------|--------------|------------------------|
| id              | SERIAL       | PRIMARY KEY             |
| type            | VARCHAR(50)  | NOT NULL                |
| match_id        | INTEGER      |                         |
| user_id         | INTEGER      |                         |
| reported_user_id| INTEGER      |                         |
| details         | TEXT         |                         |
| status          | VARCHAR(20)  | DEFAULT 'pending'       |
| reviewed_by     | INTEGER      |                         |
| reviewed_at     | TIMESTAMP    |                         |
| created_at      | TIMESTAMP    | DEFAULT NOW()           |

#### admin_log
| Column      | Type         | Constraints            |
|------------|--------------|------------------------|
| id         | SERIAL       | PRIMARY KEY             |
| admin_id   | INTEGER      | NOT NULL                |
| action     | VARCHAR(100) | NOT NULL                |
| target_type| VARCHAR(50)  |                         |
| target_id  | INTEGER      |                         |
| details    | TEXT         |                         |
| created_at | TIMESTAMP    | DEFAULT NOW()           |

### ER Diagram

```
  +----------+       +--------+       +---------+
  |  users   |<------| matches|------>|  games  |
  +----------+  1:N  +--------+  N:1  +---------+
  | id (PK)  |       | id (PK)|       | id (PK) |
  | email    |       | game_id|       | name    |
  | username |       | p1_id  |       | slug    |
  | elo_rating|      | p2_id  |       | min/max |
  | wallet   |       | stake  |       +---------+
  | role     |       | status |
  | banned   |       | winner |
  +----+-----+       +---+----+
       |                  |
       |    +-------------+--------+
       |    |                      |
       v    v                      v
  +----------+           +------------------+
  |leaderboard|          | match_proofs     |
  +----------+           +------------------+
  | user_id  |           | match_id         |
  | game_id  |           | user_id          |
  | elo/wins |           | file_path        |
  | season   |           | review_status    |
  +----------+           +------------------+

  +--------------------+     +-----------+
  | wallet_transactions|     |   flags   |
  +--------------------+     +-----------+
  | user_id            |     | type      |
  | type               |     | match_id  |
  | amount             |     | user_id   |
  | match_id           |     | reported  |
  +--------------------+     | status    |
                             +-----------+

  +-----------+
  | admin_log |
  +-----------+
  | admin_id  |
  | action    |
  | target    |
  +-----------+
```

## API Routes

### Auth (`/auth`)
| Method | Path             | Auth | Description                        |
|--------|-----------------|------|------------------------------------|
| GET    | /auth/register   | No   | Registration form                   |
| POST   | /auth/register   | No   | Register new user (rate limited)    |
| GET    | /auth/login      | No   | Login form                          |
| POST   | /auth/login      | No   | Login with email/password (rate limited) |
| GET    | /auth/logout     | No   | Clear auth cookie and redirect      |

### Games (`/games`)
| Method | Path            | Auth | Description                        |
|--------|----------------|------|------------------------------------|
| GET    | /games          | No   | List all active games with player counts |
| GET    | /games/:slug    | No   | Game detail with matches, leaderboard, waiting matches |

### Matches (`/matches`)
| Method | Path                  | Auth | Description                              |
|--------|-----------------------|------|------------------------------------------|
| GET    | /matches              | Yes  | User's matches (tabs: active/completed/disputed) |
| GET    | /matches/create       | Yes  | Create match form (game selection, stake) |
| POST   | /matches/create       | Yes  | Create match (deducts stake from wallet)  |
| GET    | /matches/:id          | No   | Match detail (players, proofs, status)    |
| POST   | /matches/:id/join     | Yes  | Join a waiting match (deducts stake)      |
| POST   | /matches/:id/proof    | Yes  | Upload proof screenshot (multipart)       |
| POST   | /matches/:id/report   | Yes  | Report match winner (honesty/dispute)     |
| POST   | /matches/:id/flag     | Yes  | Flag/report a player in a match           |

### Wallet (`/wallet`)
| Method | Path             | Auth | Description                        |
|--------|-----------------|------|------------------------------------|
| GET    | /wallet          | Yes  | Balance + transaction history       |
| POST   | /wallet/deposit  | Yes  | Mock deposit (1-10000)              |
| POST   | /wallet/withdraw | Yes  | Mock withdrawal                     |

### Leaderboard (`/leaderboard`)
| Method | Path                      | Auth | Description                    |
|--------|--------------------------|------|--------------------------------|
| GET    | /leaderboard              | No   | Global leaderboard (top 50)    |
| GET    | /leaderboard/:gameSlug    | No   | Per-game leaderboard (top 50)  |

### Profile (`/profile`)
| Method | Path                  | Auth | Description                    |
|--------|-----------------------|------|--------------------------------|
| GET    | /profile/:username    | No   | Public profile (stats, matches)|
| POST   | /profile/:id/report   | Yes  | Report a user                  |

### Admin (`/admin`)
| Method | Path                          | Auth  | Description                           |
|--------|-------------------------------|-------|---------------------------------------|
| GET    | /admin                        | Admin | Dashboard (users, matches, revenue, flags) |
| GET    | /admin/users                  | Admin | User list (search, filter by role/ban) |
| POST   | /admin/users/:id/role         | Admin | Change user role                       |
| POST   | /admin/users/:id/ban          | Admin | Ban user (cancels matches, refunds)    |
| POST   | /admin/users/:id/unban        | Admin | Unban user                             |
| GET    | /admin/matches                | Admin | All matches (filter by status)         |
| POST   | /admin/matches/:id/resolve    | Admin | Resolve disputed match (set winner/cancel) |
| GET    | /admin/flags                  | Admin | Flag queue (filter by status)          |
| POST   | /admin/flags/:id/dismiss      | Admin | Dismiss flag                           |
| POST   | /admin/flags/:id/action       | Admin | Take action on flag (ban/cancel match) |
| GET    | /admin/logs                   | Admin | Activity log (200 most recent)         |

### Other
| Method | Path    | Auth | Description           |
|--------|---------|------|-----------------------|
| GET    | /       | No   | Homepage (games, active matches, top players) |
| GET    | /faq    | No   | FAQ page               |
| GET    | /health | No   | Health check endpoint  |
| WS     | /ws     | No   | WebSocket for match updates |

## Authentication & Authorization

### Auth flow
1. User registers with email, username, password
2. Password hashed with bcryptjs (12 rounds)
3. JWT signed with `JWT_SECRET`, contains: `id`, `username`, `display_name`, `role`
4. JWT stored in httpOnly cookie (`token`), 7-day expiry, sameSite=lax
5. Every request: cookie parsed -> JWT verified -> user attached to `request.user`
6. Banned check: on every request, DB query checks if user is banned; if so, cookie cleared

### Role hierarchy
- **owner** > **admin** > **user**
- Only owners can promote users to admin/owner
- Owners cannot be banned
- Admins cannot ban other admins (only owners can)
- Admin role always verified from DB (not JWT) on admin routes

### Rate limiting
- In-memory per-IP rate limiter on auth endpoints
- 10 attempts per 15-minute window
- Returns 429 on exceeded limit
- Map cleanup runs every 60 seconds

## Security Measures

### Password hashing
- bcryptjs with 12 salt rounds

### Security headers (all responses)
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 0` (modern browsers, CSP preferred)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### Content moderation (`utils/moderation.js`)
- Phone number detection (regex, >= 8 digits)
- Email address detection
- Threat/harassment patterns (kill, find, swat, doxx, etc.)
- Profanity filter (EN/IT/DE slurs)
- Gaming toxicity detection (informational, not auto-ban)
- Applied to: match reports, flag details, profile reports

### SQL injection prevention
- All queries use parameterized placeholders (`$1`, `$2`, etc.)
- No string interpolation in SQL queries
- Integer IDs parsed with `parseInt()` before use

### File upload validation
- Allowed extensions: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
- Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
- Max file size: 10 MB (`@fastify/multipart` limit)
- Filename sanitized: UUID-style generated filenames prevent path traversal
- Match ID sanitized: `parseInt()` to prevent directory traversal

### Cookie security
- `httpOnly: true` (no JS access)
- `sameSite: lax` (CSRF mitigation)
- `secure: false` (behind Caddy reverse proxy on internal network)
- `path: /`
- 7-day max age

### Input validation
- Email regex validation
- Username: 3-50 characters
- Password: 8-1000 characters
- Display name: max 100 characters
- Body size limit: 1 MB

### Error handling
- Global error handler suppresses stack traces in production
- Returns generic error message in production mode

## Admin System

### Dashboard metrics
- Total registered users
- Active matches (waiting + active + proof_required)
- Total staked amount (completed matches)
- Platform revenue (5% of completed match payouts)
- Pending flags count
- Recent disputed matches
- Recent pending flags

### User management
- Search by username, email, display name
- Filter by role (user/admin/owner) and ban status
- Role changes: owner-only for admin/owner assignments
- Ban: sets `banned=true`, cancels all active matches, refunds all stakes via transactions
- Unban: clears ban status and reason

### Match management
- View all matches with status filter
- Resolve disputed matches:
  - **Set winner**: completes match, pays winner (2x stake), updates ELO
  - **Cancel**: refunds both players' stakes

### Flag/report queue
- Filter by status (pending/dismissed/actioned)
- Dismiss: marks flag as reviewed
- Action: can ban reported user or cancel flagged match with refunds
- Auto-flags from content moderation appear alongside manual reports

### Activity logging
- All admin actions logged to `admin_log` table
- Logged actions: role_change, ban_user, unban_user, resolve_match, cancel_match, dismiss_flag, action_flag
- Includes admin_id, target type/id, details, timestamp

## Swiss Legal Compliance

### Gambling Law Exemption (BGS/LJAr)

DuelStake is **NOT gambling** under Swiss law. The Swiss Federal Act on Gambling (Bundesgesetz uber Geldspiele, BGS / Loi sur les jeux d'argent, LJAr) defines gambling as games where the outcome depends predominantly on chance (Art. 3 BGS).

DuelStake qualifies as a **skill-based competition** because:
1. Matches are 1v1 in established competitive video games (FIFA, CS2, Valorant, etc.)
2. The outcome depends entirely on player skill -- there is no random element in the match result
3. Art. 1 para. 2 BGS explicitly exempts competitions where skill is the predominant factor
4. The platform does not operate games of chance, lotteries, or casino-style games

Reference: Art. 1 para. 2 and Art. 3 BGS (SR 935.51)

### Anti-Money Laundering (GwG/LBA)

While DuelStake handles monetary transactions, compliance measures include:
- **Transaction logging**: Every deposit, withdrawal, stake, win, and refund is recorded in `wallet_transactions`
- **Identity verification**: Username and email required; KYC can be enforced for high-value transactions
- **Wallet limits**: Deposits capped at 10,000 per transaction
- **Audit trail**: Complete admin_log of all administrative actions

Reference: Bundesgesetz uber die Bekampfung der Geldwascherei (GwG, SR 955.0)

### Age Restriction

- Platform requires 18+ for monetary competitions (aligned with Swiss law for money-staking skill competitions)
- Terms of service include age verification requirement

### Consumer Protection

- **Escrow system**: Stakes are held in the platform wallet during matches
- **Clear rules**: FAQ page with detailed rules for each game
- **Dispute resolution**: Proof-based dispute system with admin intervention
- **Refund policy**: Full refund on cancelled/disputed matches resolved by admin
- **Transparent fees**: 5% commission clearly communicated

### Data Protection (DSG/FADP)

- Swiss Federal Act on Data Protection (Datenschutzgesetz, DSG / FADP, SR 235.1)
- Personal data stored: email, username, display name, gaming IDs (Steam, Discord)
- Passwords hashed with bcrypt (never stored in plaintext)
- No unnecessary data collection
- Users can request account deletion
- Data stays within Swiss/EU infrastructure

## Business Model

### Revenue streams
1. **Match commission**: 5% of the combined pot (winner payout = 2x stake, platform takes 5%)
2. **Future**: Premium subscriptions for enhanced features

### Commission calculation
- Player 1 stakes CHF 10, Player 2 stakes CHF 10
- Total pot: CHF 20
- Platform commission: CHF 1 (5%)
- Winner payout: CHF 19

Note: In the current MVP, the full pot (2x stake) is paid to the winner. The 5% commission is tracked for reporting but not yet deducted from payouts.

### ELO Rating System
- K-factor: 32 (standard)
- Starting ELO: 1000
- Formula: Standard ELO calculation with expected score based on rating difference
- Per-game leaderboards with seasonal resets

## Deployment

### Docker container
- Runs via Docker on Mac Mini (Portainer)
- Caddy reverse proxy maps `.local` domain to port 4004
- Tailscale network for team access

### Environment variables
| Variable       | Description                    | Default                                              |
|---------------|--------------------------------|------------------------------------------------------|
| PORT          | Server port                     | 4004                                                  |
| DATABASE_URL  | PostgreSQL connection string    | postgresql://duelstake_app:duelstake_pass@localhost:5432/stz_duelstake |
| JWT_SECRET    | JWT signing secret              | change-me                                             |
| COOKIE_SECRET | Cookie signing secret           | change-me                                             |
| NODE_ENV      | Environment (production/dev)    | (not set)                                             |
| UPLOAD_DIR    | File upload directory           | ./data/uploads                                        |

### Health check
- `GET /health` returns `{ status: 'ok', service: 'duelstake', timestamp: '...' }`

### Graceful shutdown
- Handles SIGTERM and SIGINT
- Closes Fastify server, then PostgreSQL pool

## User Flows

### Registration -> Login -> Play

```
  Register
  (email, username, password)
      |
      v
  Auto-login (JWT cookie set)
      |
      v
  Homepage (games, active matches, top players)
      |
      v
  Browse Games -> Select Game -> View Waiting Matches
      |
      +---> Create Match (set stake) --> Wallet deducted --> Wait for opponent
      |
      +---> Join Match (stake matched) --> Wallet deducted --> Match active
```

### Match Lifecycle

```
  [WAITING] -- Player 2 joins --> [ACTIVE]
      |                               |
      |                     Play the game externally
      | (Creator cancels)             |
      v                               v
  [CANCELLED]              Upload proof screenshot
  (refund)                          |
                                    v
                             [PROOF_REQUIRED]
                                    |
                           Report winner
                          /              \
                         v                v
               Honest report         Self-report as winner
               (opponent won)             |
                    |                     v
                    v              [DISPUTED]
              [COMPLETED]               |
              (winner paid,        Admin resolves
               ELO updated)      /              \
                                v                v
                         Set winner          Cancel match
                         [COMPLETED]         [CANCELLED]
                                             (both refunded)
```

## Monitoring & Logging

### Activity logs
- `admin_log` table records all administrative actions with timestamps
- Fastify logger (pino) for request/error logging
- Global error handler catches unhandled errors

### Error handling
- Global Fastify error handler returns sanitized messages in production
- Database errors caught per-route with try/catch
- Transaction rollback on any failure in wallet/match operations

### Health check
- `GET /health` endpoint for monitoring
- Returns service name and timestamp
