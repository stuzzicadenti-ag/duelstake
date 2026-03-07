# DuelStake

Competitive gaming matchmaking platform — find opponents, set stakes, and prove your skill.

## Overview

DuelStake is a competitive gaming matchmaking platform where players can compete in 1v1 duels, tournaments, and ranked ladders across popular games like FIFA, Call of Duty, Fortnite, Valorant, and more.

## Features

- **1v1 Duels** — Head-to-head matches with real money stakes (EUR 1–1000)
- **Tournaments** — Bracket-style competitions (8–256 players)
- **Ranked Ladders** — Free competitive play with XP-based progression
- **Free Play** — Casual matches for practice
- **Skill-Based Matchmaking** — Algorithm pairs opponents of equal skill
- **Anti-Cheat Protection** — Fair play guaranteed

## Tech Stack

- HTML5 + CSS3 (vanilla, no frameworks)
- GitHub Pages (static hosting)
- GitHub Actions CI/CD

## Architecture

```
duelstake/
├── src/
│   ├── index.html          # Landing page
│   ├── css/
│   │   └── style.css       # Styles
│   └── robots.txt          # Search engine directives
├── .github/
│   └── workflows/
│       ├── deploy.yml       # GitHub Pages deployment
│       └── lint.yml         # HTML validation + secret detection
├── .gitignore
└── README.md
```

## Deployment

| Branch | Environment | URL |
|--------|------------|-----|
| `dev` | Preview | Auto-deployed on push |
| `main` | Production | [stuzzicadenti-ag.github.io/duelstake](https://stuzzicadenti-ag.github.io/duelstake/) |

## CI/CD Pipeline

```
Push to dev  ──→ Lint ──→ Deploy Preview
Push to main ──→ Lint ──→ Deploy Production
```

- **Lint**: HTML validation (tidy) + secret detection
- **Deploy**: GitHub Pages via Actions artifact upload

## Development

```bash
# Clone
git clone https://github.com/stuzzicadenti-ag/duelstake.git
cd duelstake

# Open locally
open src/index.html
```

## Pricing Model

| Plan | Price | Features |
|------|-------|----------|
| Free | EUR 0/mo | 3 matches/day, basic matchmaking |
| Pro | EUR 9.99/mo | Unlimited matches, stats dashboard, priority matchmaking |
| Team | EUR 29.99/mo | Team management (10), private tournaments, API access |

## Roadmap

- [ ] i18n support (DE, FR, IT, EN)
- [ ] Backend API integration
- [ ] User authentication
- [ ] Payment processing
- [ ] Real-time matchmaking engine
- [ ] Mobile app

## License

All rights reserved. Copyright 2026 Stuzzicadenti AG.
