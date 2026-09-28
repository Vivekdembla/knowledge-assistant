from google import genai
from google.genai import types

from app.core.config import settings


class EmbeddingConfigurationError(RuntimeError):
    pass


class EmbeddingService:
    def __init__(self) -> None:
        if not settings.google_api_key:
            raise EmbeddingConfigurationError(
                "GOOGLE_API_KEY is required to generate embeddings"
            )
        self.client = genai.Client(api_key=settings.google_api_key)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self._embed(texts, "RETRIEVAL_DOCUMENT")

    def embed_query(self, query: str) -> list[float]:
        vectors = self._embed([query], "RETRIEVAL_QUERY")
        return vectors[0]

    def _embed(self, texts: list[str], task_type: str) -> list[list[float]]:
        if not texts:
            return []
        response = self.client.models.embed_content(
            model=settings.embedding_model,
            contents=texts,
            config=types.EmbedContentConfig(
                task_type=task_type,
                output_dimensionality=settings.embedding_dimensions,
            ),
        )
        if not response.embeddings:
            raise RuntimeError("Gemini returned no embeddings")
        vectors = [embedding.values for embedding in response.embeddings]
        if len(vectors) != len(texts):
            raise RuntimeError("Gemini returned an unexpected number of embeddings")
        if any(len(vector) != settings.embedding_dimensions for vector in vectors):
            raise RuntimeError("Gemini returned an unexpected embedding dimension")
        return vectors
