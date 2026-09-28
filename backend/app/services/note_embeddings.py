import logging
import uuid

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.knowledge import Note, NoteChunk
from app.services.document_embeddings import BATCH_SIZE
from app.services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


def embed_note_chunks(database: Session, note_id: uuid.UUID) -> dict[str, int | str]:
    note = database.get(Note, note_id)
    if note is None:
        raise LookupError("Note not found")

    note.status = "embedding"
    database.commit()
    chunks = (
        database.query(NoteChunk)
        .filter(NoteChunk.note_id == note_id, NoteChunk.embedding.is_(None))
        .order_by(NoteChunk.chunk_index)
        .all()
    )
    total_chunks = (
        database.query(NoteChunk).filter(NoteChunk.note_id == note_id).count()
    )

    try:
        embedded_chunks = 0
        if chunks:
            embedding_service = EmbeddingService()
            for start in range(0, len(chunks), BATCH_SIZE):
                batch = chunks[start : start + BATCH_SIZE]
                vectors = embedding_service.embed([chunk.content for chunk in batch])
                if len(vectors) != len(batch):
                    raise RuntimeError(
                        "Embedding provider returned an unexpected batch size"
                    )
                for chunk, vector in zip(batch, vectors):
                    chunk.embedding = vector
                embedded_chunks += len(batch)
                database.commit()
        note.status = "ready"
        database.commit()
    except Exception:
        database.rollback()
        note = database.get(Note, note_id)
        if note is not None:
            note.status = "embedding_failed"
            database.commit()
        raise

    return {
        "note_id": str(note_id),
        "embedded_chunks": embedded_chunks,
        "total_chunks": total_chunks,
    }


def embed_note_in_background(note_id: str) -> None:
    database = SessionLocal()
    try:
        embed_note_chunks(database, uuid.UUID(note_id))
    except Exception:
        logger.exception("Background embedding failed for note %s", note_id)
    finally:
        database.close()
