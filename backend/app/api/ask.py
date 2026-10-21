import logging

from fastapi import APIRouter, Depends, HTTPException
from google.genai.errors import APIError
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.services.embeddings import EmbeddingConfigurationError
from app.services.knowledge_qa import NoEmbeddedChunksError, answer_from_knowledge

router = APIRouter(tags=["knowledge"])
logger = logging.getLogger(__name__)


class AskRequest(BaseModel):
    query: str = Field(min_length=3, max_length=2000)
    top_k: int = Field(default=6, ge=1, le=12)


@router.post("/ask")
def ask_knowledge(
    request: AskRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return answer_from_knowledge(db, request.query.strip(), user.id, request.top_k)
    except NoEmbeddedChunksError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except EmbeddingConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except APIError as error:
        logger.warning("Gemini question answering request failed: %s", error)
        response_status = 429 if error.code == 429 else 502
        detail = (
            "Gemini quota or rate limit exceeded"
            if response_status == 429
            else "Gemini question answering request failed"
        )
        raise HTTPException(status_code=response_status, detail=detail) from error
    except Exception as error:
        logger.exception("Knowledge question answering failed")
        raise HTTPException(
            status_code=502, detail="Could not generate a grounded answer"
        ) from error
