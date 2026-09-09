# inter-prep-api

Express + TypeScript backend for the Interview Prep Kit. Turns a job description,
company website, and timeline into a structured interview preparation dossier.

Companion repo: `inter-prep-web` (Next.js frontend). The two repos talk only over
HTTP — no shared code. Types are intentionally duplicated (`src/core/types` here,
`lib/types` there); if the API shape changes, update both.

## Setup

```bash
npm install
cp .env.example .env   # fill in keys, see below
npm run dev            # Express on :5001
```

## Environment (`.env`)

| Key | Purpose |
|-----|---------|
| `LLM_PROVIDER` | `auto` \| `openrouter` \| `gemini` |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Recommended LLM path (`google/gemini-2.5-flash`) |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | Direct-Google fallback |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Session signing secret ( أمسك random hex, never commit) |
| `CLIENT_URL` | Frontend origin(s) allowed by CORS, comma-separated |
| `ALLOW_LOCAL_HOSTS` | `true` for local dev/batch eval, `false` in production |

Without LLM keys the pipeline runs in heuristic fallback mode (works, lower quality).
Without MongoDB it uses an in-memory store (data lost on restart).

## Scripts

| Command | What |
|---------|------|
| `npm run dev` | Watch-mode API server |
| `npm run build` / `npm start` | Compile to `dist/` / run compiled server |
| `npm test` / `npm run test:coverage` | Vitest suite |
| `npm run evaluate -- --input cases.json --output kits.json` | Batch CLI over many cases |

## API

* `GET /health` — status + DB mode
* `POST /api/auth/register|login|logout`, `GET /api/auth/me`
* `GET /api/kits`, `GET /api/kits/:id`, `POST /api/kits/generate`, `PUT /api/kits/:id`, `POST /api/kits/:id/regenerate`, `DELETE /api/kits/:id`
* `GET /api/kits/:id/deck`, `POST /api/kits/:id/confidence`
