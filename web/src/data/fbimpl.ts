import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  GoogleAuthProvider, getAuth, getRedirectResult, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type Auth, type User,
} from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, type Firestore } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const env = import.meta.env;

const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

interface Fb {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}
let fb: Fb | null = null;

export function firebase(): Fb {
  if (fb) return fb;
  if (!firebaseConfigured) throw new Error("Firebase is not configured");
  const app = initializeApp({
    apiKey: env.VITE_FIREBASE_API_KEY,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  });
  if (env.VITE_RECAPTCHA_SITE_KEY) {
    if (location.hostname === "localhost") (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(env.VITE_RECAPTCHA_SITE_KEY), isTokenAutoRefreshEnabled: true });
  }
  const db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    ignoreUndefinedProperties: true,
  });
  fb = { app, auth: getAuth(app), db };
  return fb;
}

export function onUser(cb: (u: User | null) => void): () => void {
  const { auth } = firebase();
  void getRedirectResult(auth).catch(() => undefined);
  return onAuthStateChanged(auth, cb);
}

export async function signInGoogle(): Promise<void> {
  const { auth } = firebase();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    const code = (e as { code?: string }).code ?? "";
    if (code === "auth/popup-blocked" || code === "auth/operation-not-supported-in-this-environment") await signInWithRedirect(auth, provider);
    else if (code !== "auth/popup-closed-by-user" && code !== "auth/cancelled-popup-request") throw e;
  }
}

export async function signOutUser(): Promise<void> {
  await signOut(firebase().auth);
}

/** The AI enrichment Cloud Function. Throws with a readable code when the daily allowance is spent. */
export async function callEnrich(word: string, hints: { pos?: string; en?: string; examples?: string[] }): Promise<unknown> {
  const { app } = firebase();
  const fn = httpsCallable(getFunctions(app, env.VITE_FUNCTIONS_REGION || "asia-southeast1"), "enrich");
  const res = await fn({ word, ...hints });
  return res.data;
}
