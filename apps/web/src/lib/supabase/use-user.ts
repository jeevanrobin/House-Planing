"use client";

import * as React from "react";
import type { User } from "@supabase/supabase-js";
import { hasSupabase } from "./config";
import { supabase } from "./client";

/** The signed-in user (undefined while loading, null when signed out). */
export function useUser(): User | null | undefined {
  const [user, setUser] = React.useState<User | null | undefined>(hasSupabase ? undefined : null);
  React.useEffect(() => {
    if (!hasSupabase) return;
    const sb = supabase();
    sb.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);
  return user;
}
