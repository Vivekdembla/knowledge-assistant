import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.ask import router as ask_router
from app.api.briefs import router as briefs_router
from app.api.documents import router as documents_router
from app.api.gmail import router as gmail_router
from app.api.notes import router as notes_router
from app.core.config import settings
from app.db.session import Base, engine
from app.models import knowledge

app = FastAPI(title="Knowledge OS API", version="0.1.0")
logger = logging.getLogger(__name__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.include_router(documents_router, prefix="/api")
app.include_router(gmail_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(ask_router, prefix="/api")
app.include_router(briefs_router, prefix="/api")


@app.on_event("startup")
def create_tables() -> None:
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    except Exception:
        logger.warning(
            "Could not create the pgvector extension automatically. "
            "Enable the vector extension in your database dashboard."
        )
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id VARCHAR(128)")
        )
        connection.execute(
            text("ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id VARCHAR(128)")
        )
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_documents_user_id ON documents (user_id)"
            )
        )
        connection.execute(
            text("CREATE INDEX IF NOT EXISTS ix_notes_user_id ON notes (user_id)")
        )
        connection.execute(
            text(
                "ALTER TABLE gmail_oauth_states "
                "ADD COLUMN IF NOT EXISTS client_type VARCHAR(16) NOT NULL DEFAULT 'web'"
            )
        )
        for status in ("chunked", "embedding", "ready", "embedding_failed"):
            connection.execute(
                text(f"ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS '{status}'")
            )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
