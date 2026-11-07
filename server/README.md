# Adaptive Running Coach — BE

Node (Express + TypeScript) API for Adaptive Running Coach with mock Garmin-shaped data.

## Setup

```bash
npm install
npm run dev
```

API listens on http://localhost:4000.

## Pair with UI

Use [Adaptive-Running-Coach---UI](https://github.com/ujjwalpathaak/Adaptive-Running-Coach---UI).

## Garmin Personal API

This backend uses the **Personal** program (pull your own data), not Business Starter (push-only).

1. Create a key via the [Garmin Connect Developer Program](https://developer.garmin.com/gc-developer-program/overview/) Personal flow in Garmin Connect Web.
2. Copy `server/.env.example` to `server/.env` and set `GARMIN_PERSONAL_API_KEY`.
3. Restart the server, then open `/runs` in the UI.

Endpoints:

- `GET /api/garmin/status`
- `GET /api/garmin/runs` — supports `?refresh=1` to bypass cache
- `GET /api/garmin/runs/:id` — supports `?refresh=1`
- `POST /api/garmin/cache/clear`

## Cache (Redis primary, memory fallback)

Garmin list/detail responses are cached to avoid hammering the Personal API.

| Store | Role |
| --- | --- |
| **Redis** (`REDIS_URL`) | Primary |
| **In-memory** | Automatic fallback if Redis is down / missing |

On this machine Redis may not be installed yet — the API still runs using memory. On a laptop with Redis at `redis://127.0.0.1:6379`, it will prefer Redis (and retry reconnect every 30s if Redis starts later).

```bash
# optional local Redis
redis-server
# or Docker:
# docker run -d --name arc-redis -p 6379:6379 redis:7
```
