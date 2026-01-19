"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AuthCallbackClient() {
  const router = useRouter();
  const params = useSearchParams();
  const [msg, setMsg] = useState("Signing you in…");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;  
    ran.current = true;
    (async () => {
      try {
        // 1) Let supabase-js parse session from the URL / storage
        // For your /auth/v1/verify?token=... flow, there is typically no `code` here.
        // But if there is, exchange it.
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }

        // 2) Wait until session is actually available
        // Small retry loop prevents the "apikey role anon" mismatch.
        let sessionUserId: string | null = null;
        for (let i = 0; i < 10; i++) {
          const { data, error } = await supabase.auth.getSession();
          if (error) throw error;
          sessionUserId = data.session?.user?.id ?? null;
          if (sessionUserId) break;
          await new Promise((r) => setTimeout(r, 150));
        }

        if (!sessionUserId) {
          setMsg("Signed in, but no session found. Open the link in the same browser you used to request it.");
          return;
        }
        await new Promise((r) => setTimeout(r, 150)); // Allow auth session to fully propagate before DB calls.

        // 3) Decide what to do next:
        // If this callback was for joining a timeline, just go there.
        const next = params.get("next") || "/";

        // If next is a timeline URL, don’t create a new couple.
        if (next.startsWith("/t/")) {
          router.replace(next);
          return;
        }

        // 4) Otherwise: this was "Start your timeline" flow. Create couple + membership here.
        setMsg("Creating your timeline…");

        const { data, error: rpcErr } = await supabase.rpc("create_couple_and_join");
        if (rpcErr) throw rpcErr;

        const coupleId =
          typeof data === "string"
            ? data
            : (data as any)?.id ?? (Array.isArray(data) ? (data[0] as any)?.id : null);

        if (!coupleId) {
          throw new Error("Failed to create timeline (no couple id returned).");
        }

        router.replace(`/t/${coupleId}`);

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
