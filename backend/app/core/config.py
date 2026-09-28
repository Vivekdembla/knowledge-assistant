from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = (
        "postgresql+psycopg://knowledge:knowledge@localhost:5432/knowledge"
    )
    storage_path: str = "../storage/documents"
    max_upload_size_mb: int = 25
    allowed_origins: str = "http://localhost:3000"
    google_api_key: str | None = None
    embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = 1536
    generation_model: str = "gemini-2.5-flash"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
