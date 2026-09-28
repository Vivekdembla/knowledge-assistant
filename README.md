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

## Week 1 API

- `POST /api/documents/upload` accepts a PDF, enforces the configured size limit, stores it under `storage/documents`, extracts page-aware text, and writes chunks.
- `GET /api/documents` returns uploaded documents ordered by creation time.
- Upload automatically queues Gemini embeddings after chunks are committed. `POST /api/documents/{document_id}/embed` remains available to retry failed or incomplete embedding jobs.
- `POST /api/notes` saves a titled note, chunks it, and automatically queues Gemini embeddings; `GET /api/notes` lists saved notes and processing states.
- `POST /api/notes/{note_id}/embed` retries a failed or incomplete note embedding job.
- `POST /api/ask` embeds a question, retrieves the closest PDF and note chunks with pgvector, and asks Gemini to answer from those passages with source citations.

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
