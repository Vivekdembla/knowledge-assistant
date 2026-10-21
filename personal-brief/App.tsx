import { StatusBar } from "expo-status-bar";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "./src/lib/supabase";

const DEFAULT_API_URL = Platform.select({
  ios: "http://127.0.0.1:8000",
  android: "http://10.0.2.2:8000",
  default: "http://localhost:8000",
});

type NoteRecord = {
  id: string;
  title: string;
  content: string;
  status: string;
};

type DocumentRecord = {
  id: string;
  name: string;
  status: string;
};

type NoteSaveResult = NoteRecord & { chunks: number };
type DocumentUploadResult = DocumentRecord & {
  chunks: number;
  embedding_status: string;
};
type AnswerResult = { answer: string; citations: unknown[] };
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
  citations: Array<{ label: string; source_name: string }>;
  created_at: string | null;
};

async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers || {}),
    },
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.detail ?? `Request failed: ${response.status}`);
  }

  return data as T;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!supabase);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState(
    DEFAULT_API_URL ?? "http://localhost:8000",
  );
  const [noteTitle, setNoteTitle] = useState("Mobile note");
  const [noteContent, setNoteContent] = useState(
    "This note is being saved from the mobile app to verify the knowledge assistant can ingest personal context.",
  );
  const [query, setQuery] = useState("What is this project about?");
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [noteResult, setNoteResult] = useState<NoteSaveResult | null>(null);
  const [documentResult, setDocumentResult] =
    useState<DocumentUploadResult | null>(null);
  const [answerResult, setAnswerResult] = useState<AnswerResult | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailStatus | null>(null);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [gmailMessage, setGmailMessage] = useState("");
  const [dailyBriefs, setDailyBriefs] = useState<DailyBrief[]>([]);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefMessage, setBriefMessage] = useState("");
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setNotes([]);
        setDocuments([]);
      }
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshLists = useCallback(async () => {
    if (!session) return;
    setLoadingNotes(true);
    try {
      const [noteList, documentList, emailStatus, briefList] =
        await Promise.all([
          requestJson<NoteRecord[]>(
            `${apiBaseUrl}/api/notes`,
            {},
            session.access_token,
          ),
          requestJson<DocumentRecord[]>(
            `${apiBaseUrl}/api/documents`,
            {},
            session.access_token,
          ),
          requestJson<GmailStatus>(
            `${apiBaseUrl}/api/gmail/status`,
            {},
            session.access_token,
          ),
          requestJson<DailyBrief[]>(
            `${apiBaseUrl}/api/briefs?limit=10`,
            {},
            session.access_token,
          ),
        ]);
      setNotes(noteList);
      setDocuments(documentList);
      setGmailStatus(emailStatus);
      setDailyBriefs(briefList);
    } catch (error) {
      Alert.alert(
        "Connection issue",
        `Unable to load sources: ${String(error)}`,
      );
    } finally {
      setLoadingNotes(false);
    }
  }, [apiBaseUrl, session]);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => void refreshLists(), 0);
    return () => clearTimeout(timer);
  }, [refreshLists, session]);

  useEffect(() => {
    const handleGmailReturn = (url: string | null) => {
      if (!url?.startsWith("personalbrief://gmail-connected")) return;
      const params = Linking.parse(url).queryParams;
      if (params?.gmail === "connected") {
        setGmailMessage("Gmail connected. Sync when you are ready.");
        void refreshLists();
      } else if (params?.gmail_error) {
        setGmailMessage("Gmail connection did not finish. Please try again.");
      }
    };
    void Linking.getInitialURL().then(handleGmailReturn);
    const subscription = Linking.addEventListener("url", (event) =>
      handleGmailReturn(event.url),
    );
    return () => subscription.remove();
  }, [refreshLists]);

  const handleSaveNote = async () => {
    if (!noteTitle.trim() || !noteContent.trim()) {
      Alert.alert(
        "Missing note content",
        "Add a title and note text before saving.",
      );
      return;
    }

    setSavingNote(true);
    try {
      const result = await requestJson<NoteSaveResult>(
        `${apiBaseUrl}/api/notes`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title: noteTitle.trim(),
            content: noteContent.trim(),
          }),
        },
        session?.access_token,
      );

      setNoteResult(result);
      setNoteTitle("");
      setNoteContent("");
      await refreshLists();
      Alert.alert("Note saved", `Saved ${result.title} to knowledge.`);
    } catch (error) {
      Alert.alert("Note upload failed", String(error));
    } finally {
      setSavingNote(false);
    }
  };

  const handleUploadPdf = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        return;
      }

      const asset = result.assets[0];
      const file = {
        uri: asset.uri,
        name: asset.name || "uploaded.pdf",
        type: asset.mimeType || "application/pdf",
      };

      setUploadingFile(true);
      const formData = new FormData();
      formData.append("file", file as unknown as Blob);

      const uploadResponse = await requestJson<DocumentUploadResult>(
        `${apiBaseUrl}/api/documents/upload`,
        {
          method: "POST",
          body: formData,
        },
        session?.access_token,
      );

      setDocumentResult(uploadResponse);
      await refreshLists();
      Alert.alert(
        "PDF uploaded",
        `${uploadResponse.name} is now queued for indexing.`,
      );
    } catch (error) {
      Alert.alert("Upload failed", String(error));
    } finally {
      setUploadingFile(false);
    }
  };

  const handleAsk = async () => {
    if (!query.trim()) {
      Alert.alert(
        "Ask a question",
        "Add a question before asking the assistant.",
      );
      return;
    }

    setAsking(true);
    try {
      const result = await requestJson<AnswerResult>(
        `${apiBaseUrl}/api/ask`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: query.trim(), top_k: 6 }),
        },
        session?.access_token,
      );

      setAnswerResult(result);
      Alert.alert("Answer ready", "The latest response has been loaded.");
    } catch (error) {
      Alert.alert("Query failed", String(error));
    } finally {
      setAsking(false);
    }
  };

  const handleAuth = async () => {
    if (!supabase) {
      setAuthMessage(
        "Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable login.",
      );
      return;
    }
    setAuthBusy(true);
    setAuthMessage("");
    try {
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
      if (result.error) {
        setAuthMessage(result.error.message);
      } else if (authMode === "sign-up" && !result.data.session) {
        setAuthMessage(
          "Check your email to confirm your account, then sign in.",
        );
      }
    } catch (error) {
      setAuthMessage(String(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const handleSignOut = async () => {
    const { error } = (await supabase?.auth.signOut()) ?? { error: null };
    if (error) Alert.alert("Sign out failed", error.message);
  };

  const handleConnectGmail = async () => {
    if (!session) return;
    setGmailBusy(true);
    setGmailMessage("");
    try {
      const result = await requestJson<{ authorization_url: string }>(
        `${apiBaseUrl}/api/gmail/connect-url?client_type=mobile`,
        { method: "POST" },
        session.access_token,
      );
      await Linking.openURL(result.authorization_url);
    } catch (error) {
      setGmailMessage(String(error));
    } finally {
      setGmailBusy(false);
    }
  };

  const handleSyncGmail = async () => {
    if (!session) return;
    setGmailBusy(true);
    setGmailMessage("Syncing up to 100 messages from the last 30 days...");
    try {
      const result = await requestJson<{
        imported_messages: number;
        embedding_status: string;
      }>(
        `${apiBaseUrl}/api/gmail/sync`,
        { method: "POST" },
        session.access_token,
      );
      setGmailMessage(
        `Imported ${result.imported_messages} new messages. Embeddings are being prepared.`,
      );
      await refreshLists();
    } catch (error) {
      setGmailMessage(String(error));
    } finally {
      setGmailBusy(false);
    }
  };

  const handleDisconnectGmail = async () => {
    if (!session) return;
    setGmailBusy(true);
    try {
      await requestJson<void>(
        `${apiBaseUrl}/api/gmail/connection`,
        { method: "DELETE" },
        session.access_token,
      );
      setGmailStatus({
        connected: false,
        email_address: null,
        synced_messages: 0,
      });
      setGmailMessage("Gmail disconnected and imported messages deleted.");
    } catch (error) {
      setGmailMessage(String(error));
    } finally {
      setGmailBusy(false);
    }
  };

  const handleGenerateBrief = async () => {
    if (!session || generatingBrief) return;
    setGeneratingBrief(true);
    setBriefMessage("");
    try {
      const result = await requestJson<DailyBrief>(
        `${apiBaseUrl}/api/briefs/daily`,
        { method: "POST" },
        session.access_token,
      );
      setDailyBriefs((current) => [
        result,
        ...current.filter((brief) => brief.id !== result.id),
      ]);
    } catch (error) {
      setBriefMessage(String(error));
    } finally {
      setGeneratingBrief(false);
    }
  };

  if (!authReady || (supabase && !session)) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={styles.authContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.eyebrow}>Personal AI Brief</Text>
          <Text style={styles.title}>
            {authMode === "sign-up" ? "Create account" : "Welcome back"}
          </Text>
          <Text style={styles.subtitle}>
            Your notes and documents are private to your account.
          </Text>
          <View style={styles.card}>
            <Text style={styles.authLabel}>Email</Text>
            <TextInput
              value={authEmail}
              onChangeText={setAuthEmail}
              style={styles.input}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
            />
            <Text style={styles.authLabel}>Password</Text>
            <TextInput
              value={authPassword}
              onChangeText={setAuthPassword}
              style={styles.input}
              secureTextEntry
              autoComplete={
                authMode === "sign-up" ? "new-password" : "current-password"
              }
            />
            {authMessage || !supabase ? (
              <Text style={styles.authError}>
                {authMessage ||
                  "Configure the Supabase public URL and anon key to enable login."}
              </Text>
            ) : null}
            <Pressable
              style={styles.primaryButton}
              onPress={() => void handleAuth()}
              disabled={
                !supabase ||
                authBusy ||
                !authEmail.trim() ||
                authPassword.length < 8
              }
            >
              {authBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {authMode === "sign-up" ? "Create account" : "Sign in"}
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                setAuthMode(authMode === "sign-up" ? "sign-in" : "sign-up");
                setAuthMessage("");
              }}
              style={styles.authSwitch}
            >
              <Text style={styles.secondaryButtonText}>
                {authMode === "sign-up"
                  ? "Already registered? Sign in"
                  : "New here? Create an account"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.screen}>
        <StatusBar style="light" />
        <View style={styles.authContent}>
          <Text style={styles.authError}>
            Configure the Supabase URL and public anon key to enable login.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerWrap}>
          <Text style={styles.eyebrow}>Personal AI Brief</Text>
          <Text style={styles.title}>Connected to your knowledge</Text>
          <Text style={styles.subtitle}>{session.user.email}</Text>
          <Text style={styles.subtitle}>
            Note uploads, PDF indexing, and grounded Q&amp;A all run against the
            backend below.
          </Text>
        </View>

        <View style={styles.apiBox}>
          <Text style={styles.sectionTitle}>Backend URL</Text>
          <TextInput
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://127.0.0.1:8000"
          />
          <Pressable
            style={styles.secondaryButton}
            onPress={() => void refreshLists()}
          >
            <Text style={styles.secondaryButtonText}>
              {loadingNotes ? "Refreshing..." : "Refresh sources"}
            </Text>
          </Pressable>
          <Pressable
            style={styles.signOutButton}
            onPress={() => void handleSignOut()}
          >
            <Text style={styles.secondaryButtonText}>Sign out</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Gmail</Text>
          <Text style={styles.metaLabel}>
            {gmailStatus?.connected
              ? `${gmailStatus.email_address} · ${gmailStatus.synced_messages} messages indexed`
              : "Not connected · read-only access"}
          </Text>
          <View style={styles.gmailActions}>
            {gmailStatus?.connected ? (
              <>
                <Pressable
                  style={styles.primaryButton}
                  onPress={() => void handleSyncGmail()}
                  disabled={gmailBusy}
                >
                  {gmailBusy ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Sync mail</Text>
                  )}
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => void handleDisconnectGmail()}
                  disabled={gmailBusy}
                >
                  <Text style={styles.secondaryButtonText}>Disconnect</Text>
                </Pressable>
              </>
            ) : (
              <Pressable
                style={styles.primaryButton}
                onPress={() => void handleConnectGmail()}
                disabled={gmailBusy}
              >
                {gmailBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonText}>Connect Gmail</Text>
                )}
              </Pressable>
            )}
          </View>
          <Text style={styles.gmailHint}>
            Sync imports up to 100 messages from the last 30 days.
          </Text>
          {gmailMessage ? (
            <Text style={styles.gmailHint}>{gmailMessage}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Your daily brief</Text>
          <Text style={styles.metaLabel}>
            Combines recent email with your notes and documents.
          </Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void handleGenerateBrief()}
            disabled={generatingBrief}
          >
            {generatingBrief ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Generate daily brief</Text>
            )}
          </Pressable>
          {briefMessage ? (
            <Text style={styles.gmailHint}>{briefMessage}</Text>
          ) : null}
          {dailyBriefs[0] ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>
                Latest ·{" "}
                {dailyBriefs[0].created_at
                  ? new Date(dailyBriefs[0].created_at).toLocaleString()
                  : "saved"}
              </Text>
              <Text style={styles.answerText}>{dailyBriefs[0].summary}</Text>
              {dailyBriefs[0].citations.map((citation) => (
                <Text key={citation.label} style={styles.sourceItemMeta}>
                  [{citation.label}] {citation.source_name}
                </Text>
              ))}
            </View>
          ) : null}
          {dailyBriefs.length > 1 ? (
            <View style={styles.briefHistory}>
              <Text style={styles.resultLabel}>
                Previous briefs ({dailyBriefs.length - 1})
              </Text>
              {dailyBriefs.slice(1).map((brief) => (
                <View key={brief.id} style={styles.sourceItem}>
                  <Text style={styles.sourceItemMeta}>
                    {brief.created_at
                      ? new Date(brief.created_at).toLocaleString()
                      : brief.title}
                  </Text>
                  <Text style={styles.answerText}>{brief.summary}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>1. Save a note</Text>
          <TextInput
            value={noteTitle}
            onChangeText={setNoteTitle}
            placeholder="Note title"
            style={styles.input}
          />
          <TextInput
            value={noteContent}
            onChangeText={setNoteContent}
            placeholder="Write the note content here"
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={5}
          />
          <Pressable
            style={styles.primaryButton}
            onPress={() => void handleSaveNote()}
            disabled={savingNote}
          >
            {savingNote ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Save note</Text>
            )}
          </Pressable>
          {noteResult ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Saved note response</Text>
              <Text style={styles.mutedText}>
                {JSON.stringify(noteResult, null, 2)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>2. Upload a PDF</Text>
          <Pressable
            style={styles.primaryButton}
            onPress={() => void handleUploadPdf()}
            disabled={uploadingFile}
          >
            {uploadingFile ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Choose PDF</Text>
            )}
          </Pressable>
          {documentResult ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Upload response</Text>
              <Text style={styles.mutedText}>
                {JSON.stringify(documentResult, null, 2)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>3. Ask a question</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ask the assistant something about your saved context"
            style={[styles.input, styles.textArea]}
            multiline
            numberOfLines={4}
          />
          <Pressable
            style={styles.primaryButton}
            onPress={() => void handleAsk()}
            disabled={asking}
          >
            {asking ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryButtonText}>Ask assistant</Text>
            )}
          </Pressable>
          {answerResult ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultLabel}>Answer</Text>
              <Text style={styles.answerText}>{answerResult.answer}</Text>
              <Text style={styles.resultLabel}>Citations</Text>
              <Text style={styles.mutedText}>
                {JSON.stringify(answerResult.citations, null, 2)}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Saved sources</Text>
          <Text style={styles.metaLabel}>
            {notes.length} notes / {documents.length} documents
          </Text>
          <View style={styles.sourceList}>
            {notes.map((note) => (
              <View key={note.id} style={styles.sourceItem}>
                <Text style={styles.sourceItemTitle}>Note: {note.title}</Text>
                <Text style={styles.sourceItemMeta}>Status: {note.status}</Text>
              </View>
            ))}
            {documents.map((document) => (
              <View key={document.id} style={styles.sourceItem}>
                <Text style={styles.sourceItemTitle}>
                  Document: {document.name}
                </Text>
                <Text style={styles.sourceItemMeta}>
                  Status: {document.status}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#081120",
  },
  authContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 40,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 64,
    paddingBottom: 36,
  },
  headerWrap: {
    marginBottom: 18,
  },
  eyebrow: {
    color: "#8DB3FF",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: "#F5F7FF",
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  },
  subtitle: {
    color: "#B7C6E3",
    fontSize: 14,
    marginTop: 8,
    lineHeight: 22,
  },
  apiBox: {
    backgroundColor: "#101D34",
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#1B2E52",
  },
  card: {
    backgroundColor: "#101D34",
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#1B2E52",
  },
  cardTitle: {
    color: "#F4F8FF",
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 12,
  },
  gmailActions: {
    gap: 10,
  },
  gmailHint: {
    color: "#A8BADD",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
  },
  briefHistory: {
    gap: 10,
    marginTop: 16,
  },
  authLabel: {
    color: "#DCE6FF",
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 8,
  },
  authError: {
    color: "#FFB4A7",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 12,
  },
  authSwitch: {
    alignItems: "center",
    paddingTop: 18,
  },
  input: {
    backgroundColor: "#0B1629",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#243A5D",
    color: "#F4F8FF",
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    fontSize: 15,
  },
  textArea: {
    minHeight: 110,
    textAlignVertical: "top",
  },
  primaryButton: {
    backgroundColor: "#6C8CFF",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonText: {
    color: "#F8FAFF",
    fontWeight: "700",
    fontSize: 15,
  },
  secondaryButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#6C8CFF",
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  secondaryButtonText: {
    color: "#AFC6FF",
    fontWeight: "700",
    fontSize: 14,
  },
  signOutButton: {
    alignItems: "center",
    paddingVertical: 12,
    marginTop: 8,
  },
  resultBox: {
    marginTop: 14,
    backgroundColor: "#0B1629",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1D2F4B",
    padding: 12,
  },
  resultLabel: {
    color: "#90C9FF",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  answerText: {
    color: "#EAF2FF",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 12,
  },
  mutedText: {
    color: "#D5E3FF",
    fontSize: 12,
    lineHeight: 20,
  },
  metaLabel: {
    color: "#B7C6E3",
    fontSize: 12,
    marginBottom: 10,
  },
  sourceList: {
    gap: 8,
  },
  sourceItem: {
    backgroundColor: "#0B1629",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#203152",
    padding: 10,
  },
  sourceItemTitle: {
    color: "#F5F7FF",
    fontWeight: "700",
    fontSize: 14,
  },
  sourceItemMeta: {
    color: "#A8BADD",
    fontSize: 12,
    marginTop: 4,
  },
  sectionTitle: {
    color: "#F1F5FE",
    fontSize: 16,
    fontWeight: "700",
  },
});
