"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_KEY, SUPABASE_URL, hasSupabase } from "./config";

let client: SupabaseClient | null = null;

/** The browser Supabase client (one per tab). Throws if Supabase isn't configured. */
export function supabase(): SupabaseClient {
  if (!hasSupabase) throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / _PUBLISHABLE_KEY).");
  client ??= createBrowserClient(SUPABASE_URL, SUPABASE_KEY);
  return client;
}
