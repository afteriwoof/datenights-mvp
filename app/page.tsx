"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LandingPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const redirectTo = useMemo(() => {
  return typeof window === "undefined"
    ? ""
    : `${window.location.origin}/auth/callback?next=/`;
  }, []);


  useEffect(() => {
    let mounted = true;

    // If user already has a session, create a new couple immediately.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session) {
        await createCoupleAndGo();
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      if (session) {
        await createCoupleAndGo();
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function sendMagicLink() {
    setBusy(true);
    setStatus(null);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
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

async function createCoupleAndGo() {
  setBusy(true);
  setStatus(null);

  try {
    const { data: sessionData, error: sessErr } = await supabase.auth.getSession();
    if (sessErr) throw sessErr;

    const user = sessionData.session?.user;

    // IMPORTANT: never early-return while busy=true
    if (!user) {
      setBusy(false);
      return;
    }

    // 1) Create couple
    const { data: couple, error: coupleErr } = await supabase
      .from("couples")
      .insert({})
      .select("id")
      .single();

    if (coupleErr) throw coupleErr;

    // 2) Join as member
    const { error: memErr } = await supabase
      .from("couple_members")
      .insert({ couple_id: couple.id, user_id: user.id });

    if (memErr) throw memErr;

    // 3) Go to timeline (we don't need to setBusy(false) because we leave the page)
inc
    router.push(`/t/${couple.id}`);
  } catch (e: any) {
    setStatus(e?.message ?? "Failed to create timeline.");
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
          <button className="button" onClick={sendMagicLink} disabled={busy || !email}>
            Start your timeline
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
