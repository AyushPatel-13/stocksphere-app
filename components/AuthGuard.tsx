"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

/**
 * The gate's waiting screen.
 *
 * Shown while supabase.auth.getUser() is in flight, before the page body or the
 * redirect to /login. It used to be the literal string "Loading..." at 24px on
 * a bare black page, which was the only unpolished screen left in the auth
 * flow. Same shell and palette as the auth card.
 */
const GUARD_STYLES = `
.guard-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px: 64px from the h-16
     class plus its own 1px bottom border. Subtracting 64 left 1px over. */
  min-height: calc(100vh - 65px);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 40px 16px 72px;
}
.guard-spinner {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 3px solid #1f1f1f;
  border-top-color: #22c55e;
  animation: guard-spin 0.8s linear infinite;
}
@keyframes guard-spin {
  to { transform: rotate(360deg); }
}
.guard-text {
  margin: 0;
  font-size: 14px;
  color: #888;
}
@media (prefers-reduced-motion: reduce) {
  .guard-spinner { animation-duration: 1.8s; }
}
`;

export default function AuthGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.push("/login");
      } else {
        setLoading(false);
      }
    });
  }, [router]);

  if (loading) {
    return (
      <div className="guard-root" role="status" aria-live="polite">
        <style>{GUARD_STYLES}</style>

        <span className="guard-spinner" aria-hidden="true" />

        <p className="guard-text">Checking your session…</p>
      </div>
    );
  }

  return <>{children}</>;
}