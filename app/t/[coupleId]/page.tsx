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
    return typeof window === "undefined" ? "" : `${window.location.origin}/t/${coupleId}`;
  }, [coupleId]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSessionReady(true);
      setIsAuthed(Boolean(data.session));
      if (data.session) {
        await joinCoupleIfNeeded();
        await loadEntries();
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setSessionReady(true);
      setIsAuthed(Boolean(session));
      if (session) {
        await joinCoupleIfNeeded();
        await loadEntries();
      } else {
        setEntries([]);
        setSignedUrls({});
        setJoinState("idle");
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

  async function joinCoupleIfNeeded() {
    setJoinState("joining");
    setNotice(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user?.id;
    if (!userId) {
      setJoinState("error");
      return;
    }

    // Attempt to insert membership. If already a member, this may fail with duplicate key.
    const { error } = await supabase
      .from("couple_members")
      .insert({ couple_id: coupleId, user_id: userId });

    if (!error) {
      setJoinState("joined");
      return;
    }

    // If duplicate key -> already joined; treat as success.
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("duplicate key") || msg.includes("already exists")) {
      setJoinState("joined");
      return;
    }

    // If trigger exception -> couple full.
    if (msg.includes("already has two members") || msg.includes("two members")) {
      setJoinState("full");
      setNotice("This timeline already has two members.");
      return;
    }

    setJoinState("error");
    setNotice(error.message);
  }

  async function loadEntries() {
    setLoadingEntries(true);
    setNotice(null);
    try {
      const { data, error } = await supabase
        .from("entries")
        .select("id,couple_id,created_at,title,photo_path,created_by_user_id")
        .eq("couple_id", coupleId)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const list = (data ?? []) as Entry[];
      setEntries(list);

      // Create signed URLs for photos (private bucket)
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

    // Generate signed URLs in parallel (safe at this small scale)
    await Promise.all(
      withPhotos.map(async (e) => {
        if (!e.photo_path) return;
        const { data, error } = await supabase.storage
          .from("photos")
          .createSignedUrl(e.photo_path, 60 * 60); // 1 hour
        if (!error && data?.signedUrl) {
          updates[e.id] = data.signedUrl;
        }
      })
    );

    setSignedUrls((prev) => ({ ...prev, ...updates }));
  }

  async function addEntry() {
    setSaving(true);
    setNotice(null);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const createdAt = new Date(dateStr + "T12:00:00").toISOString(); // stable midday timestamp

      // 1) Insert entry (without photo_path first)
      const { data: inserted, error: insErr } = await supabase
        .from("entries")
        .insert({
          couple_id: coupleId,
          created_at: createdAt,
          title: title.trim(),
          created_by_user_id: userId,
          photo_path: null,
        })
        .select("id,couple_id,created_at,title,photo_path,created_by_user_id")
        .single();

      if (insErr) throw insErr;
      let entry = inserted as Entry;

      // 2) If photo, upload then update photo_path
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

        const { data: updated, error: updErr } = await supabase
          .from("entries")
          .update({ photo_path: path })
          .eq("id", entry.id)
          .select("id,couple_id,created_at,title,photo_path,created_by_user_id")
          .single();

        if (updErr) throw updErr;
        entry = updated as Entry;

        // Signed URL for this new photo
        const { data: signed, error: signErr } = await supabase.storage
          .from("photos")
          .createSignedUrl(path, 60 * 60);
        if (!signErr && signed?.signedUrl) {
          setSignedUrls((prev) => ({ ...prev, [entry.id]: signed.signedUrl }));
        }
      }

      // 3) Update UI (newest first)
      setEntries((prev) => [entry, ...prev]);

      // Reset form
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

  // --- UI states ---

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
            <button className="button" onClick={sendMagicLink} disabled={!email}>
              Send link
            </button>
          </div>

          {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}
        </div>
      </main>
    );
  }

  if (joinState === "joining") {
    return (
      <main className="container">
        <div className="card">Joining timeline…</div>
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
                <code style={{ fontSize: 12 }}>{typeof window !== "undefined" ? window.location.href : ""}</code>
              </div>
            </div>
          </div>

          <button className="button" onClick={() => setShowForm(true)}>
            Add entry
          </button>
        </div>

        {notice && <div className="notice" style={{ marginTop: 12 }}>{notice}</div>}

        <div className="hr" />

        {/* Empty state */}
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

        {/* Feed */}
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

      {/* Add Entry Modal (simple inline modal) */}
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
