/**
 * Supabase project settings. The publishable key is designed to be public:
 * every table is protected by row-level security (supabase/migrations).
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** False in builds without Supabase settings (e.g. CI): auth features hide themselves. */
export const hasSupabase = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;
