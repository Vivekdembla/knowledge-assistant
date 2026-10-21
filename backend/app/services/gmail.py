import base64
import logging
import re
import uuid
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html import unescape

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.knowledge import Email, EmailChunk, GmailConnection
from app.services.pdf_ingestion import chunk_pages

logger = logging.getLogger(__name__)
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_API_URL = "https://gmail.googleapis.com/gmail/v1/users/me"
MAX_MESSAGES_PER_SYNC = 100


def _decode_body(payload: dict) -> str:
    body = payload.get("body", {}).get("data")
    mime_type = payload.get("mimeType", "")
    if body and mime_type == "text/plain":
        return base64.urlsafe_b64decode(body + "==").decode("utf-8", errors="replace")
    parts = payload.get("parts", [])
    plain_parts = [_decode_body(part) for part in parts]
    plain_text = "\n".join(text for text in plain_parts if text.strip())
    if plain_text:
        return plain_text
    if body and mime_type == "text/html":
        html = base64.urlsafe_b64decode(body + "==").decode("utf-8", errors="replace")
        return unescape(re.sub(r"<[^>]+>", " ", html))
    return ""


def _message_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except (TypeError, ValueError, OverflowError):
        return None


def sync_gmail_messages(
    database: Session, user_id: str, refresh_token: str
) -> tuple[dict[str, int | str], list[uuid.UUID]]:
    token_response = httpx.post(
        GOOGLE_TOKEN_URL,
        data={
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=15.0,
    )
    token_response.raise_for_status()
    access_token = token_response.json()["access_token"]
    headers = {"Authorization": f"Bearer {access_token}"}
    list_response = httpx.get(
        f"{GMAIL_API_URL}/messages",
        params={"q": "newer_than:30d", "maxResults": MAX_MESSAGES_PER_SYNC},
        headers=headers,
        timeout=20.0,
    )
    list_response.raise_for_status()
    message_ids = [item["id"] for item in list_response.json().get("messages", [])]
    existing_ids = (
        {
            message_id
            for (message_id,) in database.query(Email.gmail_message_id)
            .filter(Email.user_id == user_id, Email.gmail_message_id.in_(message_ids))
            .all()
        }
        if message_ids
        else set()
    )
    new_email_ids: list[uuid.UUID] = []
    imported = 0
    for message_id in message_ids:
        if message_id in existing_ids:
            continue
        response = httpx.get(
            f"{GMAIL_API_URL}/messages/{message_id}",
            params={"format": "full"},
            headers=headers,
            timeout=20.0,
        )
        response.raise_for_status()
        message = response.json()
        payload = message.get("payload", {})
        metadata = {
            item.get("name", "").lower(): item.get("value", "")
            for item in payload.get("headers", [])
        }
        subject = metadata.get("subject", "(no subject)")[:998]
        sender = metadata.get("from", "Unknown sender")[:512]
        content = _decode_body(payload).strip()
        if not content:
            content = message.get("snippet", "")
        content = content[:100_000]
        if not content:
            continue
        email_record = Email(
            id=uuid.uuid4(),
            user_id=user_id,
            gmail_message_id=message_id,
            sender=sender,
            subject=subject,
            received_at=_message_datetime(metadata.get("date")),
            content=content,
            status="chunked",
        )
        chunks = [
            EmailChunk(email_id=email_record.id, chunk_index=index, content=chunk)
            for _, index, chunk in chunk_pages(
                [(1, f"From: {sender}\nSubject: {subject}\n\n{content}")]
            )
        ]
        database.add(email_record)
        database.add_all(chunks)
        new_email_ids.append(email_record.id)
        imported += 1
    database.commit()
    connection = database.get(GmailConnection, user_id)
    if connection is not None:
        connection.last_synced_at = datetime.now(timezone.utc)
        database.commit()
    return (
        {
            "listed_messages": len(message_ids),
            "imported_messages": imported,
            "already_synced": len(existing_ids),
            "embedding_status": "queued" if new_email_ids else "up_to_date",
        },
        new_email_ids,
    )
