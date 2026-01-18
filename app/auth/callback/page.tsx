import { Suspense } from "react";
import AuthCallbackClient from "./AuthCallbackClient";

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="container">
          <div className="card">Signing you in…</div>
        </main>
      }
    >
      <AuthCallbackClient />
    </Suspense>
  );
}
