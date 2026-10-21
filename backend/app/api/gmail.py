import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.core.auth import AuthenticatedUser, get_current_user
from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.knowledge import Email, GmailConnection, GmailOAuthState
from app.services.gmail import sync_gmail_messages

router = APIRouter(prefix="/gmail", tags=["gmail"])
logger = logging.getLogger(__name__)
GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"


def _completion_redirect(client_type: str, result: str) -> RedirectResponse:
    if result.startswith("error="):
        target = "gmail_error=" + result.removeprefix("error=")
    else:
        target = "gmail=" + result
    if client_type == "mobile":
        return RedirectResponse(
            f"{settings.gmail_mobile_redirect_url}?{target}", status_code=303
        )
    return RedirectResponse(
        f"{settings.gmail_web_redirect_url}?{target}", status_code=303
    )


def _require_gmail_config() -> None:
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gmail OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )
    if not settings.gmail_token_encryption_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gmail token encryption is not configured.",
        )
    try:
        Fernet(settings.gmail_token_encryption_key.encode())
    except (ValueError, TypeError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Gmail token encryption key is invalid.",
        ) from error


def _fernet() -> Fernet:
    _require_gmail_config()
    return Fernet(settings.gmail_token_encryption_key.encode())


@router.post("/connect-url")
def create_connect_url(
    client_type: str = Query(default="web", pattern="^(web|mobile)$"),
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_gmail_config()
    db.query(GmailOAuthState).filter(
        GmailOAuthState.created_at < datetime.now(timezone.utc) - timedelta(minutes=10)
    ).delete(synchronize_session=False)
    state = secrets.token_urlsafe(32)
    db.add(
        GmailOAuthState(
            state_hash=hashlib.sha256(state.encode()).hexdigest(),
            user_id=user.id,
            client_type=client_type,
        )
    )
    db.commit()
    parameters = {
        "client_id": settings.google_client_id,
        "redirect_uri": settings.gmail_redirect_uri,
        "response_type": "code",
        "scope": GMAIL_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": state,
    }
    return {"authorization_url": f"{GOOGLE_AUTH_URL}?{urlencode(parameters)}"}


@router.get("/callback")
def gmail_callback(
    state: str = Query(min_length=20, max_length=256),
    code: str | None = None,
    error: str | None = None,
):
    db = SessionLocal()
    try:
        state_hash = hashlib.sha256(state.encode()).hexdigest()
        oauth_state = db.get(GmailOAuthState, state_hash)
        if oauth_state is None:
            return RedirectResponse(
                f"{settings.gmail_web_redirect_url}?gmail_error=invalid_state",
                status_code=303,
            )
        user_id = oauth_state.user_id
        client_type = oauth_state.client_type
        complete = lambda result: _completion_redirect(client_type, result)
        created_at = oauth_state.created_at
        db.delete(oauth_state)
        db.commit()
        if created_at is None or created_at < datetime.now(timezone.utc) - timedelta(
            minutes=10
        ):
            return complete("error=expired_state")
        if error or not code:
            return complete("error=consent_denied")
        _require_gmail_config()
        token_response = httpx.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.gmail_redirect_uri,
                "grant_type": "authorization_code",
            },
            timeout=15.0,
        )
        if token_response.is_error:
            logger.warning(
                "Google OAuth token exchange failed: HTTP %s",
                token_response.status_code,
            )
            return complete("error=token_exchange")
        token_payload = token_response.json()
        granted_scopes = set(token_payload.get("scope", "").split())
        if GMAIL_SCOPE not in granted_scopes:
            return complete("error=missing_scope")
        refresh_token = token_payload.get("refresh_token")
        existing = db.get(GmailConnection, user_id)
        if not refresh_token and existing is not None:
            refresh_token = (
                _fernet().decrypt(existing.encrypted_refresh_token.encode()).decode()
            )
        if not refresh_token:
            return complete("error=missing_refresh_token")
        profile_response = httpx.get(
            "https://gmail.googleapis.com/gmail/v1/users/me/profile",
            headers={"Authorization": f"Bearer {token_payload['access_token']}"},
            timeout=15.0,
        )
        if profile_response.is_error:
            logger.warning(
                "Gmail profile lookup failed: HTTP %s", profile_response.status_code
            )
            return complete("error=profile_lookup")
        email_address = profile_response.json().get("emailAddress")
        if not email_address:
            return complete("error=profile_lookup")
        connection = existing or GmailConnection(
            user_id=user_id, email_address=email_address, encrypted_refresh_token=""
        )
        connection.email_address = email_address
        connection.encrypted_refresh_token = (
            _fernet().encrypt(refresh_token.encode()).decode()
        )
        db.add(connection)
        db.commit()
        return complete("connected")
    except (httpx.HTTPError, InvalidToken, KeyError, ValueError):
        db.rollback()
        logger.exception("Gmail OAuth callback failed")
        return complete("error=callback_failed")
    finally:
        db.close()


@router.get("/status")
def gmail_status(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = db.get(GmailConnection, user.id)
    if connection is None:
        return {"connected": False, "email_address": None, "synced_messages": 0}
    count = db.query(Email.id).filter(Email.user_id == user.id).count()
    return {
        "connected": True,
        "email_address": connection.email_address,
        "connected_at": connection.connected_at,
        "last_synced_at": connection.last_synced_at,
        "synced_messages": count,
    }


@router.post("/sync")
def sync_mail(
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = db.get(GmailConnection, user.id)
    if connection is None:
        raise HTTPException(
            status_code=409, detail="Connect a Gmail account before syncing."
        )
    try:
        refresh_token = (
            _fernet().decrypt(connection.encrypted_refresh_token.encode()).decode()
        )
    except InvalidToken as error:
        raise HTTPException(
            status_code=503,
            detail="Stored Gmail credentials could not be decrypted. Reconnect Gmail.",
        ) from error
    try:
        result, new_email_ids = sync_gmail_messages(db, user.id, refresh_token)
    except httpx.HTTPStatusError as error:
        if error.response.status_code in (401, 403):
            raise HTTPException(
                status_code=409,
                detail="Gmail access expired or was revoked. Reconnect Gmail.",
            ) from error
        logger.exception("Gmail sync provider request failed")
        raise HTTPException(
            status_code=502, detail="Gmail could not be synced right now."
        ) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=502, detail="Gmail could not be reached."
        ) from error
    if new_email_ids:
        from app.services.email_embeddings import embed_email_in_background

        for email_id in new_email_ids:
            background_tasks.add_task(embed_email_in_background, str(email_id))
    return result


@router.delete("/connection", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_gmail(
    user: AuthenticatedUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    connection = db.get(GmailConnection, user.id)
    if connection is not None:
        try:
            refresh_token = (
                _fernet().decrypt(connection.encrypted_refresh_token.encode()).decode()
            )
            httpx.post(
                "https://oauth2.googleapis.com/revoke",
                data={"token": refresh_token},
                timeout=10.0,
            )
        except (httpx.HTTPError, InvalidToken):
            logger.warning(
                "Could not revoke Gmail token during disconnect for user %s", user.id
            )
        db.delete(connection)
        db.query(Email).filter(Email.user_id == user.id).delete(
            synchronize_session=False
        )
        db.commit()
