from pathlib import Path

from pypdf import PdfReader


def extract_pages(path: Path) -> list[tuple[int, str]]:
    reader = PdfReader(path)
    return [
        (page_number, (page.extract_text() or "").strip())
        for page_number, page in enumerate(reader.pages, start=1)
    ]


def chunk_pages(
    pages: list[tuple[int, str]], target_words: int = 550, overlap_words: int = 80
) -> list[tuple[int, int, str]]:
    chunks: list[tuple[int, int, str]] = []
    chunk_index = 0
    for page_number, text in pages:
        words = text.split()
        start = 0
        while start < len(words):
            end = min(start + target_words, len(words))
            content = " ".join(words[start:end]).strip()
            if content:
                chunks.append((page_number, chunk_index, content))
                chunk_index += 1
            if end == len(words):
                break
            start = max(end - overlap_words, start + 1)
    return chunks
