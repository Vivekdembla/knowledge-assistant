"use client";

import { ChangeEvent, useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiFetch, supabase } from "@/lib/supabase";

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
  source_type: "document" | "note" | "email";
  source_name: string;
  document_id: string | null;
  document_name: string | null;
  note_id: string | null;
  note_title: string | null;
  email_id?: string | null;
  email_subject?: string | null;
  email_sender?: string | null;
  email_received_at?: string | null;
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

type GmailStatus = {
  connected: boolean;
  email_address: string | null;
  synced_messages: number;
  last_synced_at?: string | null;
};

type DailyBrief = {
  id: string;
  title: string;
  summary: string;
  citations: Citation[];
  created_at: string | null;
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
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [isAuthenticating, setIsAuthenticating] = useState(false);
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
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailMessage, setGmailMessage] = useState("");
  const [dailyBriefs, setDailyBriefs] = useState<DailyBrief[]>([]);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefMessage, setBriefMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setDocuments([]);
        setNotes([]);
        setDailyBriefs([]);
      }
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    apiFetch("http://localhost:8000/api/documents")
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
    apiFetch("http://localhost:8000/api/notes")
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
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    apiFetch("http://localhost:8000/api/briefs?limit=10")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load briefing history.");
        return response.json();
      })
      .then((records: DailyBrief[]) => {
        if (!cancelled) setDailyBriefs(records);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setBriefMessage(
            error instanceof Error
              ? error.message
              : "Could not load briefing history.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    apiFetch("http://localhost:8000/api/gmail/status")
      .then((response) => {
        if (!response.ok) throw new Error("Could not load Gmail status.");
        return response.json();
      })
      .then((result: GmailStatus) => {
        if (!cancelled) setGmailStatus(result);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setGmailMessage(
            error instanceof Error
              ? error.message
              : "Could not load Gmail status.",
          );
      });

    const params = new URLSearchParams(window.location.search);
    const gmailResult = params.get("gmail");
    const gmailError =
      params.get("gmail_error") ??
      (gmailResult?.startsWith("error=") ? gmailResult.slice(6) : null);
    const timer = setTimeout(() => {
      if (gmailResult === "connected")
        setGmailMessage("Gmail connected. Sync when you are ready.");
      if (gmailError)
        setGmailMessage(
          `Gmail connection did not finish (${gmailError.replaceAll("_", " ")}).`,
        );
    }, 0);
    if (gmailResult || gmailError) {
      params.delete("gmail");
      params.delete("gmail_error");
      const nextUrl = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", nextUrl);
    }
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const hasActiveWork =
      documents.some((document) =>
        ["processing", "chunked", "embedding"].includes(document.status),
      ) || notes.some((note) => ["chunked", "embedding"].includes(note.status));
    if (!hasActiveWork) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await apiFetch("http://localhost:8000/api/documents");
        if (!response.ok) return;
        const records: DocumentRecord[] = await response.json();
        if (!cancelled) setDocuments(records);
        const notesResponse = await apiFetch("http://localhost:8000/api/notes");
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
  }, [documents, notes, session]);

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
      const response = await apiFetch(
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
      const response = await apiFetch("http://localhost:8000/api/ask", {
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
      const response = await apiFetch("http://localhost:8000/api/notes", {
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

  async function authenticate() {
    if (!supabase) {
      setAuthMessage(
        "Add the Supabase URL and public anon key to the web environment to enable login.",
      );
      return;
    }
    setIsAuthenticating(true);
    setAuthMessage("");
    const result =
      authMode === "sign-up"
        ? await supabase.auth.signUp({
            email: authEmail.trim(),
            password: authPassword,
          })
        : await supabase.auth.signInWithPassword({
            email: authEmail.trim(),
            password: authPassword,
          });
    setIsAuthenticating(false);
    if (result.error) {
      setAuthMessage(result.error.message);
    } else if (authMode === "sign-up" && !result.data.session) {
      setAuthMessage("Check your email to confirm your account, then sign in.");
    }
  }

  async function signOut() {
    const { error } = (await supabase?.auth.signOut()) ?? { error: null };
    if (error) setUploadMessage(error.message);
  }

  async function connectGmail() {
    setGmailBusy(true);
    setGmailMessage("");
    try {
      const response = await apiFetch(
        "http://localhost:8000/api/gmail/connect-url?client_type=web",
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "Could not start Gmail connection.");
      window.location.assign(result.authorization_url);
    } catch (error) {
      setGmailMessage(
        error instanceof Error
          ? error.message
          : "Could not start Gmail connection.",
      );
      setGmailBusy(false);
    }
  }

  async function syncGmail() {
    setGmailBusy(true);
    setGmailMessage("Syncing up to 100 messages from the last 30 days...");
    try {
      const response = await apiFetch("http://localhost:8000/api/gmail/sync", {
        method: "POST",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "Gmail sync failed.");
      setGmailMessage(
        `Imported ${result.imported_messages} new messages. Embeddings are being prepared.`,
      );
      const statusResponse = await apiFetch(
        "http://localhost:8000/api/gmail/status",
      );
      if (statusResponse.ok) setGmailStatus(await statusResponse.json());
    } catch (error) {
      setGmailMessage(
        error instanceof Error ? error.message : "Gmail sync failed.",
      );
    } finally {
      setGmailBusy(false);
    }
  }

  async function disconnectGmail() {
    setGmailBusy(true);
    try {
      const response = await apiFetch(
        "http://localhost:8000/api/gmail/connection",
        { method: "DELETE" },
      );
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.detail || "Could not disconnect Gmail.");
      }
      setGmailStatus({
        connected: false,
        email_address: null,
        synced_messages: 0,
      });
      setGmailMessage(
        "Gmail disconnected. Imported email records were deleted.",
      );
    } catch (error) {
      setGmailMessage(
        error instanceof Error ? error.message : "Could not disconnect Gmail.",
      );
    } finally {
      setGmailBusy(false);
    }
  }

  async function generateDailyBrief() {
    if (generatingBrief) return;
    setGeneratingBrief(true);
    setBriefMessage("");
    try {
      const response = await apiFetch(
        "http://localhost:8000/api/briefs/daily",
        {
          method: "POST",
        },
      );
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "Could not generate a daily brief.");
      setDailyBriefs((current) => [
        result,
        ...current.filter((brief) => brief.id !== result.id),
      ]);
    } catch (error) {
      setBriefMessage(
        error instanceof Error
          ? error.message
          : "Could not generate a daily brief.",
      );
    } finally {
      setGeneratingBrief(false);
    }
  }

  const visibleDocuments = documents.length > 0 ? documents : sampleDocuments;

  if (!authReady || (supabase && !session)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate();
          }}
          className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-7"
        >
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-[var(--accent-deep)]">
            Knowledge OS
          </p>
          <h1 className="mb-2 text-3xl font-semibold">
            {authMode === "sign-up" ? "Create your account" : "Welcome back"}
          </h1>
          <p className="mb-6 text-sm text-[var(--ink-muted)]">
            Your notes and documents are private to your account.
          </p>
          <label className="mb-4 block text-sm font-medium">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 outline-none focus:border-[#718a42]"
            />
          </label>
          <label className="mb-4 block text-sm font-medium">
            Password
            <input
              type="password"
              autoComplete={
                authMode === "sign-up" ? "new-password" : "current-password"
              }
              minLength={8}
              required
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 outline-none focus:border-[#718a42]"
            />
          </label>
          {authMessage || !supabase ? (
            <p role="status" className="mb-4 text-sm text-[#8b3928]">
              {authMessage ||
                "Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable authentication."}
            </p>
          ) : null}
          <button
            disabled={!supabase || isAuthenticating}
            className="w-full rounded-lg bg-[#17201b] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {isAuthenticating
              ? "Please wait..."
              : authMode === "sign-up"
                ? "Create account"
                : "Sign in"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode(authMode === "sign-up" ? "sign-in" : "sign-up");
              setAuthMessage("");
            }}
            className="mt-4 w-full text-sm text-[var(--ink-muted)] underline underline-offset-4"
          >
            {authMode === "sign-up"
              ? "Already have an account? Sign in"
              : "New here? Create an account"}
          </button>
        </form>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--background)] px-6">
        <p className="max-w-md text-center text-sm text-[var(--ink-muted)]">
          {authMessage ||
            "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable login."}
        </p>
      </main>
    );
  }

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
          <span className="hidden sm:block">{session.user.email}</span>
          <button
            onClick={() => void signOut()}
            className="rounded-full border border-[var(--line)] px-3 py-1.5 text-xs font-semibold hover:bg-white"
          >
            Sign out
          </button>
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
          <section className="mb-10 rounded-2xl border border-[#cbd8a7] bg-[#f8fbf0] p-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#58752c]">
                  Your personal briefing
                </p>
                <h2 className="mt-1 text-xl font-semibold">
                  What matters today?
                </h2>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  Summarize recent email alongside your saved notes and
                  documents.
                </p>
              </div>
              <button
                onClick={() => void generateDailyBrief()}
                disabled={generatingBrief}
                className="rounded-full bg-[#17201b] px-5 py-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"
              >
                {generatingBrief
                  ? "Preparing brief..."
                  : "Generate daily brief"}
              </button>
            </div>
            {briefMessage ? (
              <p role="status" className="mt-3 text-sm text-[#8b3928]">
                {briefMessage}
              </p>
            ) : null}
            {dailyBriefs[0] ? (
              <article className="mt-5 border-t border-[#dce5c5] pt-4">
                <p className="mb-2 text-xs text-[var(--ink-muted)]">
                  {dailyBriefs[0].created_at
                    ? new Date(dailyBriefs[0].created_at).toLocaleString()
                    : "Saved briefing"}
                </p>
                <p className="whitespace-pre-wrap text-sm leading-6">
                  {dailyBriefs[0].summary}
                </p>
                {dailyBriefs[0].citations.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {dailyBriefs[0].citations.map((citation) => (
                      <span
                        key={citation.label}
                        className="rounded-full border border-[#cbd8a7] bg-white px-3 py-1 text-xs text-[#526044]"
                      >
                        [{citation.label}] {citation.source_name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </article>
            ) : null}
            {dailyBriefs.length > 1 ? (
              <details className="mt-4 border-t border-[#dce5c5] pt-3">
                <summary className="cursor-pointer text-xs font-semibold text-[#526044]">
                  Earlier briefings ({dailyBriefs.length - 1})
                </summary>
                <div className="mt-3 space-y-3">
                  {dailyBriefs.slice(1).map((brief) => (
                    <article
                      key={brief.id}
                      className="border-t border-[#dce5c5] pt-3"
                    >
                      <p className="mb-1 text-xs text-[var(--ink-muted)]">
                        {brief.created_at
                          ? new Date(brief.created_at).toLocaleString()
                          : brief.title}
                      </p>
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {brief.summary}
                      </p>
                    </article>
                  ))}
                </div>
              </details>
            ) : null}
          </section>
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
          <section className="mb-10 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-5">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-[var(--ink-muted)]">
                  Email source
                </p>
                <h2 className="mt-1 text-lg font-semibold">
                  {gmailStatus?.connected
                    ? gmailStatus.email_address
                    : "Connect Gmail"}
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Read-only access. Sync imports up to 100 messages from the
                  last 30 days.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {gmailStatus?.connected ? (
                  <>
                    <button
                      disabled={gmailBusy}
                      onClick={() => void syncGmail()}
                      className="rounded-full bg-[#17201b] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {gmailBusy ? "Working..." : "Sync mail"}
                    </button>
                    <button
                      disabled={gmailBusy}
                      onClick={() => void disconnectGmail()}
                      className="rounded-full border border-[var(--line)] px-4 py-2 text-xs font-semibold disabled:opacity-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    disabled={gmailBusy}
                    onClick={() => void connectGmail()}
                    className="rounded-full bg-[#17201b] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {gmailBusy ? "Opening Google..." : "Connect Gmail"}
                  </button>
                )}
              </div>
            </div>
            {gmailStatus?.connected ? (
              <p className="mt-3 text-xs text-[var(--ink-muted)]">
                {gmailStatus.synced_messages} messages indexed
                {gmailStatus.last_synced_at
                  ? ` · last sync ${new Date(gmailStatus.last_synced_at).toLocaleString()}`
                  : ""}
              </p>
            ) : null}
            {gmailMessage ? (
              <p role="status" className="mt-3 text-xs text-[var(--ink-muted)]">
                {gmailMessage}
              </p>
            ) : null}
          </section>
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
                              : citation.source_type === "email"
                                ? ` · email from ${citation.email_sender || "unknown sender"}${citation.email_received_at ? ` · ${new Date(citation.email_received_at).toLocaleDateString()}` : ""}`
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
