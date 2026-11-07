# Adaptive Running Coach

Sample website for an adaptive running coach dashboard. React (Vite) frontend + Node (Express) API with mock Garmin-shaped training data.

## Stack

- **client/** — Vite, React, TypeScript, React Router
- **server/** — Express, TypeScript (`tsx`)

## Setup

```bash
npm run install:all
```

Or install each package separately:

```bash
npm install
npm install --prefix server
npm install --prefix client
```

## Run locally

From the repo root:

```bash
npm run dev
```

- Dashboard: http://localhost:5173  
- API: http://localhost:4000  

Vite proxies `/api` to the Express server.

## Plan rules

- The app opens straight on the dashboard (no landing page).
- If there is **no active plan**, only the setup form is shown (no activities / weekly plan).
- Setup asks for race goal (distance + goal time) and training days per week (**min 2**, max 7). Weekly mileage and session times are calculated automatically.
- Only **one** plan can exist at a time.
- After creation, the plan is **locked** (sessions cannot be edited).
- Use **End plan** to clear it, then set up a new plan.

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health check |
| `GET` | `/api/athlete` | Athlete profile summary |
| `GET` | `/api/activities` | Recent runs |
| `GET` | `/api/plan/current` | `{ plan: TrainingPlan \| null }` |
| `POST` | `/api/plan` | Create the single active plan (409 if one exists) |
| `POST` | `/api/plan/end` | End the active plan so a new one can be created |

## Next steps (not in this sample)

- Real Garmin Connect OAuth / activity sync
- Auth and persistence
- Adaptive plan generation from fitness signals
