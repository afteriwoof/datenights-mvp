"use client";

import { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function LandingPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = useMemo(() => {
    return typeof window === "undefined"
      ? ""
      : `${window.location.origin}/auth/callback?next=/`;
  }, []);

  async function sendMagicLink() {
    setBusy(true);
    setStatus(null);

    try {
      const cleaned = email.trim();
      if (!cleaned) {
        setStatus("Enter an email address.");
        setBusy(false);
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({
        email: cleaned,
        options: { emailRedirectTo: redirectTo },
      });

      if (error) throw error;

      setStatus("Check your email for the sign-in link.");
    } catch (e: any) {
      setStatus(e?.message ?? "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container">
      <div className="card">
        <h1 style={{ marginTop: 0 }}>A private timeline of your date nights.</h1>
        <p className="small" style={{ marginTop: 8 }}>
          Start in seconds. Add a photo only if you want.
        </p>

        <div className="hr" />

        <label className="small">Email</label>
        <div className="row" style={{ marginTop: 8 }}>
          <input
            className="input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            inputMode="email"
            autoComplete="email"
          />
          <button
            className="button"
            onClick={sendMagicLink}
            disabled={busy || email.trim().length === 0}
          >
            {busy ? "Sending…" : "Start your timeline"}
          </button>
        </div>

        {status && (
          <div className="notice" style={{ marginTop: 12 }}>
            {status}
          </div>
        )}
      </div>
    </main>
  );
}
