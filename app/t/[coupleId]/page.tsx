"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Entry = {
  id: string;
  couple_id: string;
  created_at: string;
  title: string;
  photo_path: string | null;
  created_by_user_id: string;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

async function getSessionWithRetry() {
  for (let i = 0; i < 10; i++) {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session) return data.session;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

export default function TimelinePage() {
  const params = useParams<{ coupleId: string }>();
  const coupleId = params.coupleId;

  const [sessionReady, setSessionReady] = useState(false);
  const [isAuthed, setIsAuthed] = useState(false);

  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const [joinState, setJoinState] = useState<"idle" | "joining" | "joined" | "full" | "error">("idle");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0, 10));
  const [title, setTitle] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});

  const redirectTo = useMemo(() => {
    return typeof window === "undefined"
      ? ""
      : `${window.location.origin}/auth/callback?next=/t/${coupleId}`;
  }, [coupleId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const session = await getSessionWithRetry();
        if (!mounted) return;

        setSessionReady(true);
        setIsAuthed(Boolean(session));

        if (session) {
          const ok = await joinCoupleIfNeeded();
          if (ok) {
            await loadEntries();
        }
        
        }
      } catch (e: any) {
        if (!mounted) return;
        setSessionReady(true);
        setIsAuthed(false);
        setNotice(e?.message ?? "Auth error.");
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
    if (!mounted) return;

    try {
        setSessionReady(true);
        setIsAuthed(Boolean(session));

        if (!session) {
        setEntries([]);
        setSignedUrls({});
        setJoinState("idle");
        }
        
    } catch (e: any) {
        setJoinState("error");
        setNotice(e?.message ?? "Auth callback failed.");
    }
    });


    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coupleId]);

  async function sendMagicLink() {
    setNotice(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) throw error;
      setNotice("Check your email for the sign-in link.");
    } catch (e: any) {
      setNotice(e?.message ?? "Something went wrong.");
    }
  }

async function joinCoupleIfNeeded(): Promise<boolean> {
  setJoinState("joining");
  setNotice(null);

  const timeout = setTimeout(() => {
    setJoinState("error");
    setNotice("Joining timed out. Tap Retry.");
  }, 8000);

  try {
    const session = await getSessionWithRetry();
    const userId = session?.user?.id;

    if (!userId) {
      setJoinState("error");
      setNotice("No session found.");
      return false;
    }

    // 1) Are we already a member?
    const { data: existing, error: selErr } = await supabase
      .from("couple_members")
      .select("couple_id")
      .eq("couple_id", coupleId)
      .eq("user_id", userId)
      .maybeSingle();

    if (selErr) throw selErr;

    if (existing) {
      setJoinState("joined");
      return true;
    }

    // 2) Not a member yet -> attempt insert
    const { error: insErr } = await supabase
      .from("couple_members")
      .insert({ couple_id: coupleId, user_id: userId });

    if (!insErr) {
      setJoinState("joined");
      return true;
    }

    const msg = (insErr.message || "").toLowerCase();

    if (msg.includes("already has two members") || msg.includes("two members")) {
      setJoinState("full");
      setNotice("This timeline already has two members.");
      return false;
    }

    setJoinState("error");
    setNotice(insErr.message);
    return false;
  } catch (e: any) {
    setJoinState("error");
    setNotice(e?.message ?? "Failed to join timeline.");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}



  async function loadEntries() {
    setLoadingEntries(true);
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("id,couple_id,created_at,title,photo_path,created_by_user_id")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const list = (data ?? []) as Entry[];
      setEntries(list);

      await hydrateSignedUrls(list);
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to load entries.");
    } finally {
      setLoadingEntries(false);
    }
  }

  async function hydrateSignedUrls(list: Entry[]) {
    const updates: Record<string, string> = {};
    const withPhotos = list.filter((e) => e.photo_path);

    await Promise.all(
      withPhotos.map(async (e) => {
        if (!e.photo_path) return;
        const { data, error } = await supabase.storage
          .from("photos")
          .createSignedUrl(e.photo_path, 60 * 60);
        if (!error && data?.signedUrl) updates[e.id] = data.signedUrl;
      })
    );

    setSignedUrls((prev) => ({ ...prev, ...updates }));
  }

  async function addEntry() {
    setSaving(true);
    setNotice(null);

    try {
      const session = await getSessionWithRetry();
      const userId = session?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const createdAt = new Date(dateStr + "T12:00:00").toISOString();

      const { data: inserted, error: insErr } = await supabase
        .from("entries")
        .insert({
            couple_id: coupleId,
            created_at: createdAt,
            title: title.trim(),
            created_by_user_id: userId,
            photo_path: null,
        })
        .select("id,couple_id,created_at,title,photo_path,created_by_user_id");

    if (insErr) throw insErr;

    const entry = inserted?.[0];
    if (!entry) throw new Error("Entry created but could not be returned (RLS on SELECT?).");
    let entryTyped = entry as Entry;

      if (photoFile) {
        const ext = photoFile.name.split(".").pop()?.toLowerCase() || "jpg";
        const fileName =
          (typeof crypto !== "undefined" && "randomUUID" in crypto)
            ? (crypto as any).randomUUID()
            : String(Date.now());

        const path = `${coupleId}/${fileName}.${ext}`;

        const { error: upErr } = await supabase.storage
          .from("photos")
          .upload(path, photoFile, { upsert: false });

        if (upErr) throw upErr;

        const { data: updatedRows, error: updErr } = await supabase
          .from("entries")
          .update({ photo_path: path })
          .eq("id", entryTyped.id)
          .select("id,couple_id,created_at,title,photo_path,created_by_user_id");

        if (updErr) throw updErr;

        const updated = updatedRows?.[0];
        if (!updated) throw new Error("Photo saved but entry could not be returned.");
        entryTyped = updated as Entry;

        const { data: signed, error: signErr } = await supabase.storage
          .from("photos")
          .createSignedUrl(path, 60 * 60);
        if (!signErr && signed?.signedUrl) {
          setSignedUrls((prev) => ({ ...prev, [entryTyped.id]: signed.signedUrl }));
        }
      }

      setEntries((prev) => [entryTyped, ...prev]);

      setTitle("");
      setPhotoFile(null);
      setShowForm(false);
      setDateStr(new Date().toISOString().slice(0, 10));
    } catch (e: any) {
      setNotice(e?.message ?? "Failed to save entry.");
    } finally {
      setSaving(false);
    }
  }

  if (!sessionReady) {
    return (
      <main className="container">
        <div className="card">Loading…</div>
      </main>
    );
  }

  if (!isAuthed) {
    return (
      <main className="container">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Sign in to view this timeline</h2>
          <p className="small">You’ll get a magic link by email.</p>

          <div className="row" style={{ marginTop: 12 }}>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              inputMode="email"
              autoComplete="email"
            />
            <button className="button" onClick={sendMagicLink} disabled={!email.trim().length}>
              Send link
            </button>
          </div>

        {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}

        </div>
      </main>
    );
  }

  if (joinState === "full") {
    return (
      <main className="container">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Timeline is full</h2>
          <p className="small">This timeline already has two members.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <h2 style={{ margin: 0 }}>Date Nights</h2>
            <div className="small" style={{ marginTop: 6 }}>
              Share this URL with your partner:
              <div style={{ marginTop: 6 }}>
                <code style={{ fontSize: 12 }}>
                  {typeof window !== "undefined" ? window.location.href : ""}
                </code>
              </div>
            </div>
          </div>

          <button className="button" onClick={() => setShowForm(true)}>
            Add entry
          </button>
        </div>

        {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}

        {joinState === "joining" && (
            <div className="notice" style={{ marginTop: 12 }}>
                Joining timeline…
            </div>
        )}
        {joinState === "error" && (
            <div className="notice" style={{ marginTop: 12 }}>
                {notice ?? "Joining failed."}
                <div style={{ marginTop: 10 }}>
                    <button
                    className="button"
                    onClick={async () => {
                        const ok = await joinCoupleIfNeeded();
                        if (ok) await loadEntries();
                    }}
                    >
                        Retry
                    </button>
                </div>
            </div>
        )}

        <div className="hr" />

        {!loadingEntries && entries.length === 0 && (
          <div className="notice">
            No entries yet.
            <div style={{ marginTop: 10 }}>
              <button className="button" onClick={() => setShowForm(true)}>
                Add your first date
              </button>
            </div>
          </div>
        )}

        {entries.map((e) => (
          <div key={e.id} className="entry">
            <div className="entryMeta">{formatDate(e.created_at)}</div>
            <div className="entryTitle">{e.title}</div>
            {e.photo_path && signedUrls[e.id] && (
              <img className="photo" src={signedUrls[e.id]} alt="" />
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            display: "grid",
            placeItems: "center",
            padding: 16,
          }}
          onClick={() => !saving && setShowForm(false)}
        >
          <div
            className="card"
            style={{ width: "100%", maxWidth: 520 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Add a date</h3>

            <label className="small">Date</label>
            <input
              className="input"
              type="date"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
              style={{ marginTop: 6 }}
              disabled={saving}
            />

            <div style={{ height: 12 }} />

            <label className="small">Description</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Pizza + late movie"
              style={{ marginTop: 6 }}
              disabled={saving}
            />

            <div style={{ height: 12 }} />

            <label className="small">Photo (optional)</label>
            <input
              className="input"
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              style={{ marginTop: 6 }}
              disabled={saving}
            />

            <div className="row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
              <button
                className="button"
                onClick={() => setShowForm(false)}
                disabled={saving}
                style={{ background: "#666" }}
              >
                Cancel
              </button>
              <button
                className="button"
                onClick={addEntry}
                disabled={saving || title.trim().length === 0}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
