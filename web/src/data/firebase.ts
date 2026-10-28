/**
 * Light facade over the Firebase SDK. Nothing here imports the SDK at load time, so local-only
 * builds (and the first paint) stay small; the SDK is fetched the first time it is needed.
 */
import type { User } from "firebase/auth";

const env = import.meta.env;

export const firebaseConfigured = Boolean(env.VITE_FIREBASE_API_KEY && env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_APP_ID);

const impl = () => import("./fbimpl.ts");

export async function onUser(cb: (u: User | null) => void): Promise<() => void> {
  return (await impl()).onUser(cb);
}
export async function signInGoogle(): Promise<void> {
  return (await impl()).signInGoogle();
}
export async function signOutUser(): Promise<void> {
  return (await impl()).signOutUser();
}
export async function callEnrich(word: string, hints: { pos?: string; en?: string; examples?: string[] }): Promise<unknown> {
  return (await impl()).callEnrich(word, hints);
}
export async function makeCloudRepo(uid: string) {
  const { CloudRepo } = await import("./cloud.ts");
  return new CloudRepo(uid);
}
