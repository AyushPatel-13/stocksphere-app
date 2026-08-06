"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export default function UserInfo() {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  if (!user) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        right: 20,
        background: "#111",
        padding: "10px",
        borderRadius: "10px",
      }}
    >
      <img
        src={user.user_metadata.avatar_url}
        width={40}
        style={{ borderRadius: "50%" }}
      />

      <p>{user.user_metadata.full_name}</p>
    </div>
  );
}