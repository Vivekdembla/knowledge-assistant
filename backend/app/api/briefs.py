import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from google.genai.errors import APIError
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser, get_current_user
from app.db.session import get_db
from app.services.daily_brief import create_daily_brief, list_daily_briefs
from app.services.embeddings import EmbeddingConfigurationError
from app.services.knowledge_qa import NoEmbeddedChunksError

router = APIRouter(prefix="/briefs", tags=["briefs"])
logger = logging.getLogger(__name__)


@router.post("/daily")
def generate_daily_brief(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    try:
        return create_daily_brief(db, user.id)
    except NoEmbeddedChunksError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except EmbeddingConfigurationError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except APIError as error:
        logger.warning("Gemini daily brief generation failed: %s", error)
        response_status = 429 if error.code == 429 else 502
        detail = (
            "Gemini quota or rate limit exceeded"
            if response_status == 429
            else "Gemini daily brief generation failed"
        )
        raise HTTPException(status_code=response_status, detail=detail) from error
    except Exception as error:
        logger.exception("Daily brief generation failed for user %s", user.id)
        raise HTTPException(
            status_code=502, detail="Could not generate a daily brief"
        ) from error


@router.get("")
def get_daily_briefs(
    limit: int = Query(default=20, ge=1, le=100),
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[dict[str, Any]]:
    return list_daily_briefs(db, user.id, limit)
