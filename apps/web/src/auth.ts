import { createClient, type Session } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.trim();
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const SUPABASE_REDIRECT_URL = import.meta.env.VITE_SUPABASE_REDIRECT_URL?.trim();
const SUPABASE_AUTH_ENABLED = parseAuthEnabledFlag(
  import.meta.env.VITE_KAIROS_AUTH_ENABLED,
);
const LOCAL_API_TOKEN = import.meta.env.VITE_KAIROS_LOCAL_API_TOKEN?.trim();
const AUTHORIZED_EMAILS = parseAuthorizedEmails(
  import.meta.env.VITE_KAIROS_ALLOWED_EMAILS,
);
const isAuthEnabled = SUPABASE_AUTH_ENABLED ?? true;

const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const supabaseClient = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
        flowType: "pkce",
      },
    })
  : null;

export type KairosSession = Session | null;
export const isSupabaseAuthConfigured = isConfigured;
export const isSupabaseAuthEnabled = isAuthEnabled;
export const isAuthorizedEmail = (email: string | null | undefined): boolean =>
  isAllowedEmail(email);

export async function getSupabaseAccessToken(): Promise<string | undefined> {
  const session = await getSupabaseSession();
  return session?.access_token;
}

export async function getKairosApiAuthHeaders(): Promise<HeadersInit> {
  if (!isAuthEnabled) {
    return {
      "x-kairos-local-request": "1",
      ...(LOCAL_API_TOKEN ? { "x-kairos-local-token": LOCAL_API_TOKEN } : {}),
    };
  }
  const accessToken = await getSupabaseAccessToken();
  return accessToken ? { authorization: `Bearer ${accessToken}` } : {};
}

export function getSupabaseSession(): Promise<KairosSession> {
  if (!supabaseClient) {
    return Promise.resolve(null);
  }

  return supabaseClient.auth.getSession().then((result) => result.data.session);
}

export function onSupabaseAuthStateChange(
  callback: (session: KairosSession) => void,
) {
  if (!supabaseClient) {
    return {
      data: {
        subscription: {
          unsubscribe() {},
        },
      },
    } as const;
  }

  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}

export function getSupabaseAuthConfiguredError(): string {
  return (
    "Supabase Auth is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your web environment."
  );
}

export function getSupabaseRedirectUrl(): string {
  if (SUPABASE_REDIRECT_URL) return SUPABASE_REDIRECT_URL;
  return `${window.location.origin}${window.location.pathname}`;
}

export async function signInWithGoogle(): Promise<void> {
  if (!supabaseClient) {
    throw new Error(getSupabaseAuthConfiguredError());
  }

  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: getSupabaseRedirectUrl(),
    },
  });

  if (error) {
    throw error;
  }
}

export async function signOutFromGoogle(): Promise<void> {
  if (!supabaseClient) {
    return;
  }

  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    throw error;
  }
}

const FALLBACK_ALLOWED_EMAILS = [
  "naman.chetwani@gmail.com",
  "sanjay.chetwani@gmail.com",
];

const AUTHORIZED_EMAIL_SET = new Set(
  AUTHORIZED_EMAILS.length > 0 ? AUTHORIZED_EMAILS : FALLBACK_ALLOWED_EMAILS,
);

function parseAuthEnabledFlag(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["0", "false", "off", "no", "disabled"].includes(normalized)) {
    return false;
  }

  if (["1", "true", "on", "yes", "enabled"].includes(normalized)) {
    return true;
  }

  return undefined;
}

function parseAuthorizedEmails(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((candidate) => candidate.trim().toLowerCase())
    .filter((candidate) => candidate.length > 0);
}

function isAllowedEmail(email: string | null | undefined): boolean {
  if (typeof email !== "string" || email.length === 0) {
    return false;
  }

  return AUTHORIZED_EMAIL_SET.has(email.trim().toLowerCase());
}
