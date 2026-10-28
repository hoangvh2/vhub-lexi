import type { Firestore } from "firebase-admin/firestore";

/** Counts one use against the account's daily allowance. Returns false when the allowance is spent. */
export interface QuotaStore {
  consume(uid: string, limit: number, now: Date): Promise<boolean>;
}

/**
 * The counter lives at users/{uid}/meta/usage, which the Firestore rules do not let any client
 * touch: only this function (admin SDK) can move it. The day rolls over at 00:00 UTC.
 */
export class FirestoreQuota implements QuotaStore {
  constructor(private readonly db: Firestore) {}

  consume(uid: string, limit: number, now: Date): Promise<boolean> {
    const ref = this.db.doc(`users/${uid}/meta/usage`);
    const day = now.toISOString().slice(0, 10);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data() as { day?: string; count?: number } | undefined;
      const count = data?.day === day && typeof data.count === "number" ? data.count : 0;
      if (count >= limit) return false;
      tx.set(ref, { day, count: count + 1 });
      return true;
    });
  }
}
