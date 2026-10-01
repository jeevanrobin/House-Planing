import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/supabase/next-path";
import { serverSupabase } from "@/lib/supabase/server";

/**
 * Landing point for Google sign-in, magic links and email confirmations:
 * exchanges the one-time code for a session cookie, then continues.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (code) {
    const supabase = await serverSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }
  const message = searchParams.get("error_description") ?? "That sign-in link is invalid or has expired.";
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`);
}
