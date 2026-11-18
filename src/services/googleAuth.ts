import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  type User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: {
    prompt?: string;
    hint?: string;
  }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            prompt?: string;
            hint?: string;
            callback: (resp: GisTokenResponse) => void;
            error_callback?: (err: { type?: string }) => void;
          }) => GisTokenClient;
        };
      };
    };
  }
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {
  // Ignore persistence errors in restricted private browsing modes
});

const GTOKEN_STORAGE_KEY = 'pos_v4_gtoken';
const TRUSTED_EMAIL_KEY = 'pos_v4_trusted_email';
let isSigningIn = false;
let inFlightSilentRefresh: Promise<string | null> | null = null;

export const getTrustedGoogleEmail = (): string | null => {
  try {
    const val = localStorage.getItem(TRUSTED_EMAIL_KEY)?.trim();
    return val || null;
  } catch {
    return null;
  }
};

export const setTrustedGoogleEmail = (email: string | null): void => {
  try {
    if (!email || !email.trim()) {
      localStorage.removeItem(TRUSTED_EMAIL_KEY);
      return;
    }
    localStorage.setItem(TRUSTED_EMAIL_KEY, email.trim());
  } catch {
    // Ignore storage errors
  }
};

interface StoredTokenEntry {
  token: string;
  expiresAt: number;
}

const loadStoredTokenEntry = (): StoredTokenEntry | null => {
  try {
    const raw = localStorage.getItem(GTOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { token?: string; expiresAt?: number };
    if (
      parsed?.token &&
      typeof parsed.expiresAt === 'number' &&
      Date.now() < parsed.expiresAt
    ) {
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    }
    localStorage.removeItem(GTOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  return null;
};

const saveStoredToken = (token: string | null, expiresInSeconds = 3300) => {
  try {
    if (!token) {
      localStorage.removeItem(GTOKEN_STORAGE_KEY);
      return;
    }
    const safeSeconds = Math.max(300, expiresInSeconds - 180);
    localStorage.setItem(
      GTOKEN_STORAGE_KEY,
      JSON.stringify({ token, expiresAt: Date.now() + safeSeconds * 1000 })
    );
  } catch {
    // Ignore storage errors
  }
};

let cachedEntry: StoredTokenEntry | null = loadStoredTokenEntry();
let cachedAccessToken: string | null = cachedEntry?.token ?? null;

export const isTokenExpiringSoon = (): boolean => {
  if (!cachedEntry) {
    cachedEntry = loadStoredTokenEntry();
    cachedAccessToken = cachedEntry?.token ?? null;
  }
  if (!cachedEntry) return true;
  return Date.now() >= cachedEntry.expiresAt - 6 * 60 * 1000;
};

const waitForGisOAuth = async (maxWaitMs = 1800): Promise<boolean> => {
  if (typeof window === 'undefined') return false;
  if (window.google?.accounts?.oauth2?.initTokenClient) return true;
  const started = Date.now();
  return new Promise((resolve) => {
    const check = setInterval(() => {
      if (window.google?.accounts?.oauth2?.initTokenClient) {
        clearInterval(check);
        resolve(true);
      } else if (Date.now() - started >= maxWaitMs) {
        clearInterval(check);
        resolve(false);
      }
    }, 120);
  });
};

export const trySilentGoogleTokenRefresh = async (
  loginHint?: string | null
): Promise<string | null> => {
  if (inFlightSilentRefresh) return inFlightSilentRefresh;

  inFlightSilentRefresh = (async () => {
    try {
      const clientId = (firebaseConfig as { oAuthClientId?: string }).oAuthClientId;
      if (!clientId) return null;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return null;

      const ready = await waitForGisOAuth(1800);
      if (!ready || !window.google?.accounts?.oauth2?.initTokenClient) {
        return null;
      }

      const hint =
        loginHint?.trim() ||
        auth.currentUser?.email ||
        getTrustedGoogleEmail() ||
        undefined;

      return await new Promise<string | null>((resolve) => {
        let settled = false;
        const finish = (token: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(token);
        };

        const timer = setTimeout(() => finish(null), 6500);

        try {
          const client = window.google!.accounts!.oauth2!.initTokenClient({
            client_id: clientId,
            scope: SCOPES.join(' '),
            prompt: '',
            hint,
            callback: (resp) => {
              if (resp?.access_token && !resp.error) {
                const exp = Number(resp.expires_in) || 3500;
                cachedAccessToken = resp.access_token;
                saveStoredToken(resp.access_token, exp);
                cachedEntry = loadStoredTokenEntry();
                finish(resp.access_token);
              } else {
                finish(null);
              }
            },
            error_callback: () => {
              finish(null);
            },
          });
          client.requestAccessToken({ prompt: '', hint });
        } catch {
          finish(null);
        }
      });
    } finally {
      inFlightSilentRefresh = null;
    }
  })();

  return inFlightSilentRefresh;
};

export const initGoogleAuth = (
  onAuthSuccess?: (user: FirebaseUser | null, token: string, email?: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, (fbUser: FirebaseUser | null) => {
    void (async () => {
      const rememberedEmail = fbUser?.email || getTrustedGoogleEmail() || undefined;
      if (fbUser?.email) {
        setTrustedGoogleEmail(fbUser.email);
      }
      if (!cachedAccessToken) {
        cachedEntry = loadStoredTokenEntry();
        cachedAccessToken = cachedEntry?.token ?? null;
      }

      if (cachedAccessToken && !isTokenExpiringSoon()) {
        onAuthSuccess?.(fbUser, cachedAccessToken, rememberedEmail);
        return;
      }

      if ((fbUser || rememberedEmail) && !isSigningIn) {
        const refreshed = await trySilentGoogleTokenRefresh(rememberedEmail);
        if (refreshed) {
          onAuthSuccess?.(fbUser, refreshed, rememberedEmail);
          return;
        }
      }

      if (cachedAccessToken) {
        onAuthSuccess?.(fbUser, cachedAccessToken, rememberedEmail);
        return;
      }

      if (!isSigningIn) {
        onAuthFailure?.();
      }
    })();
  });
};

export const googleSignIn = async (
  loginHint?: string | null,
  forceAccountSelect = false
): Promise<{
  user: FirebaseUser;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    SCOPES.forEach((scope) => provider.addScope(scope));
    const hint = loginHint?.trim() || getTrustedGoogleEmail() || undefined;
    const params: Record<string, string> = {};
    if (hint) params.login_hint = hint;
    if (forceAccountSelect) params.prompt = 'select_account';
    if (Object.keys(params).length > 0) {
      provider.setCustomParameters(params);
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('تعذر الحصول على تصريح الوصول إلى Google Sheets');
    }
    cachedAccessToken = credential.accessToken;
    saveStoredToken(cachedAccessToken, 3500);
    cachedEntry = loadStoredTokenEntry();
    if (result.user.email) {
      setTrustedGoogleEmail(result.user.email);
    }
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (err: unknown) {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/popup-blocked') {
      throw new Error(
        'حظر المتصفح نافذة تسجيل الدخول المنبثقة. يرجى السماح بالنوافذ المنبثقة لهذا الموقع ثم المحاولة مجدداً'
      );
    }
    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      throw new Error('تم إغلاق نافذة تسجيل الدخول قبل إتمام الربط');
    }
    if (code === 'auth/unauthorized-domain') {
      throw new Error(
        'هذا النطاق غير مصرّح له في إعدادات Firebase Auth (auth/unauthorized-domain)'
      );
    }
    throw err;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  if (!cachedAccessToken) {
    cachedEntry = loadStoredTokenEntry();
    cachedAccessToken = cachedEntry?.token ?? null;
  }
  return cachedAccessToken;
};

export const getCurrentGoogleUser = (): FirebaseUser | null => auth.currentUser;

export const googleLogout = async (): Promise<void> => {
  cachedAccessToken = null;
  cachedEntry = null;
  saveStoredToken(null);
  setTrustedGoogleEmail(null);
  await auth.signOut();
};

export const clearCachedToken = (): void => {
  cachedAccessToken = null;
  cachedEntry = null;
  saveStoredToken(null);
};
