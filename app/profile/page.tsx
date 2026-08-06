"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import AuthGuard from "@/components/AuthGuard";

export default function ProfilePage() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  return (
    <AuthGuard>
      <div
        style={{
          background: "#000",
          color: "white",
          minHeight: "100vh",
          padding: "40px",
          textAlign: "center",
        }}
      >
        <h1>👤 My Profile</h1>

        {user && (
          <>
            <img
              src={user.user_metadata.avatar_url}
              alt="Profile"
              style={{
                width: "140px",
                height: "140px",
                borderRadius: "50%",
                marginTop: "30px",
              }}
            />

            <h2>{user.user_metadata.full_name}</h2>

            <p>{user.email}</p>

            <button
              onClick={async () => {
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              style={{
                marginTop: "30px",
                background: "red",
                color: "white",
                border: "none",
                padding: "12px 25px",
                borderRadius: "10px",
                cursor: "pointer",
              }}
            >
              Logout
            </button>
          </>
        )}
      </div>
    </AuthGuard>
  );
}