import uuid
import logging
from pathlib import Path

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    UploadFile,
    status,
)
from google.genai.errors import APIError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.knowledge import Document, DocumentChunk, DocumentStatus
from app.services.document_embeddings import (
    embed_document_chunks,
    embed_document_in_background,
)
from app.services.embeddings import EmbeddingConfigurationError
from app.services.pdf_ingestion import chunk_pages, extract_pages

router = APIRouter(prefix="/documents", tags=["documents"])
logger = logging.getLogger(__name__)
MAX_BYTES = settings.max_upload_size_mb * 1024 * 1024


@router.post("/upload", status_code=status.HTTP_201_CREATED)
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=415, detail="Only PDF files are supported")
    document_id = uuid.uuid4()
    storage_dir = Path(settings.storage_path)
    storage_dir.mkdir(parents=True, exist_ok=True)
    destination = storage_dir / f"{document_id}.pdf"
    size = 0
    with destination.open("wb") as output:
        while block := file.file.read(1024 * 1024):
            size += len(block)
            if size > MAX_BYTES:
                destination.unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Files must be smaller than {settings.max_upload_size_mb} MB",
                )
            output.write(block)
    document = Document(
        id=document_id,
        name=file.filename or "Untitled PDF",
        storage_path=str(destination),
        mime_type=file.content_type,
    )
    try:
        chunks = [
            DocumentChunk(
                document_id=document_id,
                page_number=page,
                chunk_index=index,
                content=content,
            )
            for page, index, content in chunk_pages(extract_pages(destination))
        ]
    except Exception as error:
        destination.unlink(missing_ok=True)
        logger.exception("PDF extraction failed for document %s", document_id)
        raise HTTPException(
            status_code=422, detail="The PDF could not be extracted"
        ) from error

    try:
        db.add(document)
        db.add_all(chunks)
        document.status = DocumentStatus.chunked
        db.commit()
    except SQLAlchemyError as error:
        db.rollback()
        destination.unlink(missing_ok=True)
        logger.exception("Could not persist document %s", document_id)
        raise HTTPException(
            status_code=500, detail="The document could not be saved"
        ) from error
    background_tasks.add_task(embed_document_in_background, str(document.id))
    return {
        "id": str(document.id),
        "name": document.name,
        "mime_type": document.mime_type,
        "status": document.status,
        "created_at": document.created_at,
        "chunks": len(chunks),
        "embedding_status": "queued",
    }


@router.get("")
def list_documents(db: Session = Depends(get_db)):
    return db.query(Document).order_by(Document.created_at.desc()).all()


@router.post("/{document_id}/embed")
def embed_document(document_id: uuid.UUID, db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")

    try:
        result = embed_document_chunks(db, document_id)
    except EmbeddingConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except APIError as error:
        logger.warning(
            "Gemini API error while embedding document %s: %s",
            document_id,
            error,
        )
        response_status = 429 if error.code == 429 else 502
        detail = (
            "Gemini embedding quota or rate limit exceeded"
            if response_status == 429
            else "Gemini embedding provider request failed"
        )
        raise HTTPException(status_code=response_status, detail=detail) from error
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except Exception as error:
        logger.exception(
            "Gemini embedding failed for document %s",
            document_id,
        )
        raise HTTPException(
            status_code=502, detail="Embedding provider request failed"
        ) from error

    return {**result, "embedding_model": settings.embedding_model}
