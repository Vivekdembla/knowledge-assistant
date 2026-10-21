from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://knowledge:knowledge@localhost:5432/knowledge"
    )
    storage_path: str = "../storage/documents"
    max_upload_size_mb: int = 25
    allowed_origins: str = "http://localhost:3000"
    google_api_key: str | None = None
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    google_client_id: str | None = "client_id"
    google_client_secret: str | None = "client_secret"
    gmail_token_encryption_key: str | None = "gmail_token_encryption_key"
    gmail_redirect_uri: str = "http://localhost:8000/api/gmail/callback"
    gmail_web_redirect_url: str = "http://localhost:3000"
    gmail_mobile_redirect_url: str = "personalbrief://gmail-connected"
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 1536
    generation_model: str = "gemini-2.5-flash"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
