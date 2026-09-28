"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";

type DocumentRecord = {
  id: string;
  name: string;
  mime_type: string;
  status:
    | "processing"
    | "chunked"
    | "embedding"
    | "ready"
    | "embedding_failed"
    | "indexed"
    | "failed";
  created_at: string;
};

type Citation = {
  label: string;
  source_type: "document" | "note";
  source_name: string;
  document_id: string | null;
  document_name: string | null;
  note_id: string | null;
  note_title: string | null;
  chunk_id: string;
  page_number: number | null;
  chunk_index: number;
  similarity: number;
  excerpt: string;
};

type NoteRecord = {
  id: string;
  title: string;
  content: string;
  status: "chunked" | "embedding" | "ready" | "embedding_failed";
  created_at: string;
};

type AskResult = {
  answer: string;
  citations: Citation[];
};

const sampleDocuments = [
  {
    name: "Designing Data-Intensive Applications",
    type: "PDF",
    pages: 612,
    status: "Indexed",
    color: "#d9e9ff",
  },
  {
    name: "The Art of Learning",
    type: "PDF",
    pages: 288,
    status: "Indexed",
    color: "#ffe4c7",
  },
  {
    name: "Project Atlas / Research notes",
    type: "NOTE",
    pages: 14,
    status: "Draft",
    color: "#e9e4ff",
  },
];

const suggestions = [
  "What are the key ideas I should connect?",
  "Summarize the trade-offs in the last chapter",
  "Where do these documents disagree?",
];

export default function Home() {
  const [query, setQuery] = useState("");
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("http://localhost:8000/api/documents")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load documents.");
        return response.json();
      })
      .then((records: DocumentRecord[]) => {
        if (!cancelled) setDocuments(records);
      })
      .catch(() => {
        if (!cancelled) {
          setUploadMessage("Could not connect to the document service.");
        }
      });
    fetch("http://localhost:8000/api/notes")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load notes.");
        return response.json();
      })
      .then((records: NoteRecord[]) => {
        if (!cancelled) setNotes(records);
      })
      .catch(() => {
        if (!cancelled) setUploadMessage("Could not load saved notes.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const hasActiveWork =
      documents.some((document) =>
        ["processing", "chunked", "embedding"].includes(document.status),
      ) || notes.some((note) => ["chunked", "embedding"].includes(note.status));
    if (!hasActiveWork) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("http://localhost:8000/api/documents");
        if (!response.ok) return;
        const records: DocumentRecord[] = await response.json();
        if (!cancelled) setDocuments(records);
        const notesResponse = await fetch("http://localhost:8000/api/notes");
        if (notesResponse.ok) {
          const noteRecords: NoteRecord[] = await notesResponse.json();
          if (!cancelled) setNotes(noteRecords);
        }
      } catch {
        if (!cancelled) {
          setUploadMessage("Could not refresh document processing status.");
        }
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [documents, notes]);

  async function uploadDocument(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.type !== "application/pdf") {
      setUploadMessage("Please choose a PDF file.");
      return;
    }

    setIsUploading(true);
    setUploadMessage(`Processing ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(
        "http://localhost:8000/api/documents/upload",
        {
          method: "POST",
          body: formData,
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Upload failed.");
      setDocuments((current) => [result, ...current]);
      setUploadMessage(
        `${result.name} split into ${result.chunks} chunks. Embedding started.`,
      );
    } catch (error) {
      setUploadMessage(
        error instanceof Error ? error.message : "Upload failed.",
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function askKnowledge() {
    const question = query.trim();
    if (question.length < 3 || isAsking) return;

    setIsAsking(true);
    setAskError("");
    setAnswer(null);
    try {
      const response = await fetch("http://localhost:8000/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, top_k: 6 }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Question failed.");
      setAnswer(result);
    } catch (error) {
      setAskError(error instanceof Error ? error.message : "Question failed.");
    } finally {
      setIsAsking(false);
    }
  }

  async function saveNote() {
    if (!noteTitle.trim() || !noteContent.trim() || isSavingNote) return;
    setIsSavingNote(true);
    setUploadMessage("Saving note and preparing it for search...");
    try {
      const response = await fetch("http://localhost:8000/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: noteTitle, content: noteContent }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "Could not save note.");
      setNotes((current) => [result, ...current]);
      setNoteTitle("");
      setNoteContent("");
      setUploadMessage(
        `Note saved in ${result.chunks} chunks. Embedding started.`,
      );
    } catch (error) {
      setUploadMessage(
        error instanceof Error ? error.message : "Could not save note.",
      );
    } finally {
      setIsSavingNote(false);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  const visibleDocuments = documents.length > 0 ? documents : sampleDocuments;

  return (
    <div className="min-h-screen bg-[var(--background)]">
      <header className="flex h-20 items-center justify-between border-b border-[var(--line)] px-6 md:px-10">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#17201b] text-sm font-bold text-[var(--accent)]">
            K
          </div>
          <span className="font-semibold tracking-tight">Knowledge OS</span>
        </div>
        <div className="flex items-center gap-4 text-sm text-[var(--ink-muted)]">
          <span className="hidden sm:block">Local workspace</span>
          <div className="h-8 w-8 rounded-full bg-[#d3d9ce] text-center pt-1.5 text-xs font-bold">
            AM
          </div>
        </div>
      </header>
      <main className="mx-auto grid max-w-[1440px] gap-10 px-6 py-10 md:grid-cols-[190px_1fr] md:px-10">
        <aside className="hidden md:block">
          <p className="mb-5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--ink-muted)]">
            Workspace
          </p>
          <nav className="space-y-2 text-sm">
            <div className="rounded-lg bg-white px-3 py-2.5 font-semibold shadow-sm">
              Overview
            </div>
            <div className="px-3 py-2.5 text-[var(--ink-muted)]">
              Documents <span className="float-right text-xs">3</span>
            </div>
            <div className="px-3 py-2.5 text-[var(--ink-muted)]">
              Conversations
            </div>
          </nav>
          <div className="mt-14 border-t border-[var(--line)] pt-5">
            <p className="px-3 text-xs leading-5 text-[var(--ink-muted)]">
              Your private layer for ideas, references, and the connections
              between them.
            </p>
          </div>
        </aside>
        <section>
          <div className="mb-12 flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--accent-deep)]">
                Thursday, 25 September
              </p>
              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
                Make sense of
                <br />
                <span className="text-[var(--ink-muted)]">what you know.</span>
              </h1>
            </div>
            <button
              onClick={openFilePicker}
              className="w-fit rounded-full bg-[#17201b] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2d3e33]"
            >
              + Add knowledge
            </button>
          </div>
          <div className="mb-10 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)]">
            <div className="border-b border-[var(--line)] px-6 py-4 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
              Ask your knowledge base
            </div>
            <div className="p-6">
              <textarea
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.metaKey || event.ctrlKey)
                  ) {
                    event.preventDefault();
                    void askKnowledge();
                  }
                }}
                placeholder="Ask a question across your documents..."
                className="min-h-24 w-full resize-none bg-transparent text-xl outline-none placeholder:text-[#aeb7ad]"
              />
              <div className="mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div className="flex flex-wrap gap-2">
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setQuery(suggestion);
                        setActiveSuggestion(index);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs transition ${activeSuggestion === index && query ? "border-[#a4c75d] bg-[#eff8d7]" : "border-[var(--line)] text-[var(--ink-muted)] hover:bg-white"}`}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                <button
                  onClick={askKnowledge}
                  disabled={isAsking || query.trim().length < 3}
                  className="rounded-full bg-[var(--accent)] px-5 py-2.5 text-sm font-bold text-[#17201b] hover:bg-[#bde95a] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isAsking ? "Searching..." : "Search knowledge"}
                </button>
              </div>
            </div>
          </div>
          {(answer || askError) && (
            <section
              aria-live="polite"
              className="mb-10 border-l-2 border-[#a4c75d] pl-5"
            >
              {askError ? (
                <p className="text-sm text-[#8b3928]">{askError}</p>
              ) : answer ? (
                <>
                  <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em] text-[var(--ink-muted)]">
                    Answer from your documents
                  </p>
                  <p className="whitespace-pre-wrap text-base leading-7">
                    {answer.answer}
                  </p>
                  {answer.citations.length > 0 && (
                    <div className="mt-5 space-y-2">
                      <h3 className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
                        Sources
                      </h3>
                      {answer.citations.map((citation) => (
                        <article
                          key={citation.chunk_id}
                          className="rounded-lg border border-[var(--line)] bg-[var(--panel)] p-3"
                        >
                          <p className="text-xs font-semibold">
                            [{citation.label}] {citation.source_name}
                            {citation.source_type === "document"
                              ? ` · page ${citation.page_number}`
                              : " · note"}
                            {` · chunk ${citation.chunk_index}`}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">
                            {citation.excerpt}
                          </p>
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : null}
            </section>
          )}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">
              Recently added
            </h2>
            <button className="text-sm text-[var(--ink-muted)] hover:text-[#17201b]">
              View all
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-3">
            {visibleDocuments.map((document) => (
              <article
                key={document.name}
                className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition hover:-translate-y-0.5 hover:border-[#b8c6b5]"
              >
                <div className="mb-10 flex items-start justify-between">
                  <div
                    className="grid h-10 w-10 place-items-center rounded-lg text-[10px] font-bold"
                    style={{
                      backgroundColor:
                        "color" in document ? document.color : "#d9e9ff",
                    }}
                  >
                    {"mime_type" in document ? "PDF" : document.type}
                  </div>
                  <span
                    className={`rounded-full px-2 py-1 text-[10px] font-bold ${["ready", "indexed", "Indexed"].includes(document.status) ? "bg-[#e9f4d1] text-[#496e20]" : document.status === "embedding_failed" || document.status === "failed" ? "bg-[#f9e3de] text-[#8b3928]" : "bg-[#f1ede5] text-[#8b7651]"}`}
                  >
                    {document.status === "ready"
                      ? "Ready"
                      : document.status === "indexed"
                        ? "Indexed"
                        : document.status === "embedding_failed" ||
                            document.status === "failed"
                          ? "Embedding failed"
                          : document.status === "embedding"
                            ? "Embedding"
                            : document.status === "chunked"
                              ? "Chunked"
                              : "Processing"}
                  </span>
                </div>
                <h3 className="mb-2 line-clamp-2 min-h-12 text-sm font-semibold leading-5">
                  {document.name}
                </h3>
                <p className="text-xs text-[var(--ink-muted)]">
                  {"pages" in document
                    ? `${document.pages} pages`
                    : "PDF document"}{" "}
                  <span className="mx-1">/</span>{" "}
                  {"created_at" in document
                    ? new Date(document.created_at).toLocaleDateString()
                    : "Sample"}
                </p>
              </article>
            ))}
          </div>
          <section className="mt-10 border-t border-[var(--line)] pt-7">
            <div className="mb-4 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Saved notes
              </h2>
              <span className="text-xs text-[var(--ink-muted)]">
                Included in knowledge search
              </span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                <input
                  value={noteTitle}
                  onChange={(event) => setNoteTitle(event.target.value)}
                  maxLength={255}
                  placeholder="Note title"
                  className="w-full border-b border-[var(--line)] bg-transparent pb-2 text-sm font-semibold outline-none placeholder:font-normal placeholder:text-[#aeb7ad]"
                />
                <textarea
                  value={noteContent}
                  onChange={(event) => setNoteContent(event.target.value)}
                  maxLength={100000}
                  placeholder="Capture an idea, project detail, or something you learned..."
                  className="min-h-28 w-full resize-y bg-transparent text-sm leading-6 outline-none placeholder:text-[#aeb7ad]"
                />
                <div className="flex justify-end">
                  <button
                    onClick={saveNote}
                    disabled={
                      isSavingNote || !noteTitle.trim() || !noteContent.trim()
                    }
                    className="rounded-full bg-[#17201b] px-4 py-2 text-xs font-semibold text-white hover:bg-[#2d3e33] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSavingNote ? "Saving..." : "Save note"}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {notes.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-sm text-[var(--ink-muted)]">
                    Your saved notes will appear here.
                  </p>
                ) : (
                  notes.map((note) => (
                    <article
                      key={note.id}
                      className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4"
                    >
                      <div className="mb-2 flex items-start justify-between gap-3">
                        <h3 className="text-sm font-semibold">{note.title}</h3>
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                          {note.status === "ready"
                            ? "Ready"
                            : note.status === "embedding_failed"
                              ? "Embedding failed"
                              : note.status === "embedding"
                                ? "Embedding"
                                : "Preparing"}
                        </span>
                      </div>
                      <p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-[var(--ink-muted)]">
                        {note.content}
                      </p>
                    </article>
                  ))
                )}
              </div>
            </div>
          </section>
          <div className="mt-10 flex items-center gap-3 rounded-xl border border-dashed border-[#b8c6b5] bg-[#f8fbf3] p-5">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-[var(--accent)] text-xl">
              +
            </div>
            <div>
              <p className="text-sm font-semibold">Bring in a reference</p>
              <p className="text-xs text-[var(--ink-muted)]">
                PDF ingestion is ready for your first document.
              </p>
            </div>
            <button
              onClick={openFilePicker}
              disabled={isUploading}
              className="ml-auto rounded-full border border-[#b8c6b5] px-4 py-2 text-xs font-semibold hover:bg-white disabled:cursor-wait disabled:opacity-50"
            >
              {isUploading ? "Processing..." : "Upload PDF"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            onChange={uploadDocument}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
          />
          {uploadMessage && (
            <p role="status" className="mt-3 text-xs text-[var(--ink-muted)]">
              {uploadMessage}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
