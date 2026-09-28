import logging
import uuid

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.knowledge import Document, DocumentChunk, DocumentStatus
from app.services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)
BATCH_SIZE = 16


def embed_document_chunks(
    database: Session, document_id: uuid.UUID
) -> dict[str, int | str]:
    document = database.get(Document, document_id)
    if document is None:
        raise LookupError("Document not found")

    document.status = DocumentStatus.embedding
    database.commit()
    chunks = (
        database.query(DocumentChunk)
        .filter(
            DocumentChunk.document_id == document_id,
            DocumentChunk.embedding.is_(None),
        )
        .order_by(DocumentChunk.chunk_index)
        .all()
    )
    total_chunks = (
        database.query(DocumentChunk)
        .filter(DocumentChunk.document_id == document_id)
        .count()
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
        document.status = DocumentStatus.ready
        database.commit()
    except Exception:
        database.rollback()
        document = database.get(Document, document_id)
        if document is not None:
            document.status = DocumentStatus.embedding_failed
            database.commit()
        raise

    return {
        "document_id": str(document_id),
        "embedded_chunks": embedded_chunks,
        "total_chunks": total_chunks,
    }


def embed_document_in_background(document_id: str) -> None:
    database = SessionLocal()
    try:
        embed_document_chunks(database, uuid.UUID(document_id))
    except Exception:
        logger.exception("Background embedding failed for document %s", document_id)
    finally:
        database.close()
