import logging
import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from google.genai.errors import APIError
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.knowledge import Note, NoteChunk
from app.services.embeddings import EmbeddingConfigurationError
from app.services.note_embeddings import embed_note_chunks, embed_note_in_background
from app.services.pdf_ingestion import chunk_pages

router = APIRouter(prefix="/notes", tags=["notes"])
logger = logging.getLogger(__name__)


class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content: str = Field(min_length=1, max_length=100_000)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_note(
    request: NoteCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    title = request.title.strip()
    content = request.content.strip()
    if not title or not content:
        raise HTTPException(
            status_code=422, detail="Title and note content are required"
        )

    note = Note(id=uuid.uuid4(), title=title, content=content, status="chunked")
    chunks = [
        NoteChunk(note_id=note.id, chunk_index=index, content=chunk_content)
        for _, index, chunk_content in chunk_pages([(1, content)])
    ]
    try:
        db.add(note)
        db.add_all(chunks)
        db.commit()
        db.refresh(note)
    except SQLAlchemyError as error:
        db.rollback()
        logger.exception("Could not save note")
        raise HTTPException(
            status_code=500, detail="The note could not be saved"
        ) from error

    background_tasks.add_task(embed_note_in_background, str(note.id))
    return {
        "id": str(note.id),
        "title": note.title,
        "content": note.content,
        "status": note.status,
        "created_at": note.created_at,
        "chunks": len(chunks),
    }


@router.get("")
def list_notes(db: Session = Depends(get_db)):
    return db.query(Note).order_by(Note.created_at.desc()).all()


@router.post("/{note_id}/embed")
def retry_note_embedding(note_id: uuid.UUID, db: Session = Depends(get_db)):
    try:
        result = embed_note_chunks(db, note_id)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except EmbeddingConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except APIError as error:
        logger.warning("Gemini API error while embedding note %s: %s", note_id, error)
        response_status = 429 if error.code == 429 else 502
        detail = (
            "Gemini embedding quota or rate limit exceeded"
            if response_status == 429
            else "Gemini embedding provider request failed"
        )
        raise HTTPException(status_code=response_status, detail=detail) from error
    except Exception as error:
        logger.exception("Gemini embedding failed for note %s", note_id)
        raise HTTPException(
            status_code=502, detail="Embedding provider request failed"
        ) from error
    return result
