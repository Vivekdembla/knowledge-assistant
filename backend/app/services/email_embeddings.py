import logging
import uuid

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.knowledge import Email, EmailChunk
from app.services.document_embeddings import BATCH_SIZE
from app.services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


def embed_email_chunks(database: Session, email_id: uuid.UUID) -> None:
    email = database.get(Email, email_id)
    if email is None:
        raise LookupError("Email not found")

    email.status = "embedding"
    database.commit()
    chunks = (
        database.query(EmailChunk)
        .filter(EmailChunk.email_id == email_id, EmailChunk.embedding.is_(None))
        .order_by(EmailChunk.chunk_index)
        .all()
    )
    try:
        service = EmbeddingService()
        for start in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[start : start + BATCH_SIZE]
            vectors = service.embed([chunk.content for chunk in batch])
            for chunk, vector in zip(batch, vectors):
                chunk.embedding = vector
            database.commit()
        email.status = "ready"
        database.commit()
    except Exception:
        database.rollback()
        email = database.get(Email, email_id)
        if email is not None:
            email.status = "embedding_failed"
            database.commit()
        raise


def embed_email_in_background(email_id: str) -> None:
    database = SessionLocal()
    try:
        embed_email_chunks(database, uuid.UUID(email_id))
    except Exception:
        logger.exception("Background embedding failed for email %s", email_id)
    finally:
        database.close()
