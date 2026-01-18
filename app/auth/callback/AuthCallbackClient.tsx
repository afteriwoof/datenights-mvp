"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [msg, setMsg] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");

        // Only do PKCE exchange if code exists
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        // For verify?token=... magiclink flow, just ensure session is present.
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (!data.session) {
          setMsg(
            "Signed in, but no session found. Open the link in the same browser where you requested it."
          );
          return;
        }

        const next = params.get("next") || "/";
        router.replace(next);
      } catch (e: any) {
        setMsg(e?.message ?? "Sign-in failed.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="container">
      <div className="card">{msg}</div>
    </main>
  );
}
