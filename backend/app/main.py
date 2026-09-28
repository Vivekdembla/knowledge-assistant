from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api.ask import router as ask_router
from app.api.documents import router as documents_router
from app.api.notes import router as notes_router
from app.core.config import settings
from app.db.session import Base, engine
from app.models import knowledge

app = FastAPI(title="Knowledge OS API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)
app.include_router(documents_router, prefix="/api")
app.include_router(notes_router, prefix="/api")
app.include_router(ask_router, prefix="/api")


@app.on_event("startup")
def create_tables() -> None:
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        for status in ("chunked", "embedding", "ready", "embedding_failed"):
            connection.execute(
                text(f"ALTER TYPE documentstatus ADD VALUE IF NOT EXISTS '{status}'")
            )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
