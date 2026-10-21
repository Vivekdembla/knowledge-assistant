# Knowledge OS

A personal knowledge workspace built around grounded answers and exact source citations. The first milestone is intentionally narrow: upload PDFs, preserve page boundaries, chunk text, and store the result for retrieval.

## Stack

- Next.js 16, TypeScript, Tailwind CSS
- FastAPI, SQLAlchemy, pypdf
- PostgreSQL with the pgvector extension

## Run locally

```bash
docker compose up --build
```

In a second terminal, run the frontend:

```bash
npm run dev
```

The UI is at `http://localhost:3000`, API docs are at `http://localhost:8000/docs`, and the API health check is `http://localhost:8000/health`.

## Accounts and private data

Authentication is handled by Supabase Auth with email and password. Create a Supabase project, enable Email auth, and copy its project URL and public anon/publishable key (never use the `service_role` key in either app).

Configure the backend values in the root `.env` file used by Docker Compose:

```dotenv
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-public-anon-key
```

Configure the web app in the root `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
```

Configure the Expo app in `personal-brief/.env`:

```dotenv
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-public-anon-key
```

Restart Compose, Next.js, and Expo after setting these values. The API verifies each bearer token against Supabase and uses the verified user ID to scope notes, documents, embedding retries, and question retrieval. Native Expo sessions are stored in the device secure store. The backend auth dependency is isolated in `backend/app/core/auth.py` so the provider verifier can later be replaced when implementing custom authentication.

The API adds nullable `user_id` columns to existing note and document tables at startup. Existing records are left unowned and are not exposed to signed-in users; create or re-upload them under an account to make them searchable in that user's workspace. For local testing, Supabase email confirmation can be disabled in the project's Email Auth settings; otherwise users must confirm their email before signing in.

## Gmail connection

Gmail is connected per signed-in user with Google OAuth and the read-only `gmail.readonly` scope. The user explicitly starts a sync; each sync imports at most 100 messages matching `newer_than:30d`, avoids duplicate imports, chunks the readable message text, and queues embeddings. Imported messages become searchable alongside notes and PDFs. Disconnect revokes the Google token where possible and deletes that user's imported email content and embeddings.

In Google Cloud Console, enable the Gmail API, configure the OAuth consent screen, add your account as a test user while the app is in testing, and create a **Web application** OAuth client. Add this exact authorized redirect URI for local web testing:

```text
http://localhost:8000/api/gmail/callback
```

Put the client ID, client secret, and redirect URL in the root `.env` read by Compose:

```dotenv
GOOGLE_CLIENT_ID=your-oauth-client-id
GOOGLE_CLIENT_SECRET=your-oauth-client-secret
GMAIL_REDIRECT_URI=http://localhost:8000/api/gmail/callback
GMAIL_WEB_REDIRECT_URL=http://localhost:3000
GMAIL_MOBILE_REDIRECT_URL=personalbrief://gmail-connected
```

Generate a Fernet encryption key using the backend environment, then add its output to root `.env` as `GMAIL_TOKEN_ENCRYPTION_KEY`:

```bash
docker compose exec api python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'
```

Restart the API after setting these values. Google OAuth redirect URIs must match exactly. For a physical phone, `localhost` points at the phone, not the development computer; use an HTTPS tunnel to expose the local API and set that HTTPS callback as `GMAIL_REDIRECT_URI` in both Google Cloud and `.env`. Native callback uses the `personalbrief://` scheme, so rebuild/run a native development build after adding or changing the scheme; Expo Go does not provide a stable custom scheme. The Gmail API uses a restricted user-data scope, so testing works only for accounts listed as test users until the Google OAuth app completes applicable verification.

## Week 1 API

- `POST /api/documents/upload` accepts a PDF, enforces the configured size limit, stores it under `storage/documents`, extracts page-aware text, and writes chunks.
- `GET /api/documents` returns uploaded documents ordered by creation time.
- Upload automatically queues Gemini embeddings after chunks are committed. `POST /api/documents/{document_id}/embed` remains available to retry failed or incomplete embedding jobs.
- `POST /api/notes` saves a titled note, chunks it, and automatically queues Gemini embeddings; `GET /api/notes` lists saved notes and processing states.
- `POST /api/notes/{note_id}/embed` retries a failed or incomplete note embedding job.
- `POST /api/ask` embeds a question, retrieves the closest PDF and note chunks with pgvector, and asks Gemini to answer from those passages with source citations.
- `POST /api/briefs/daily` generates and stores a user-specific briefing from recent Gmail plus relevant PDFs, notes, and email chunks; `GET /api/briefs` returns that user's saved brief history.

To enable embeddings, set `GOOGLE_API_KEY` in a root `.env` file and restart the API container. The worker uses Google's `gemini-embedding-001` model and stores 1536-dimensional vectors in `document_chunks.embedding` and `note_chunks.embedding`. Document states are `processing`, `chunked`, `embedding`, `ready`, and `embedding_failed` (`indexed` is retained for existing records); notes use `chunked`, `embedding`, `ready`, and `embedding_failed`.

Question answering uses `gemini-2.5-flash` by default. `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, and `GENERATION_MODEL` can be set in the root `.env` to override these defaults.

Embedding currently uses FastAPI in-process background tasks. Successful batches are committed individually and skipped on retry, but a process restart may interrupt a job; a durable queue is a later reliability improvement.

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
