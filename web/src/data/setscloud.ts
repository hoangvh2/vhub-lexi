/**
 * Where Bộ đề live in the account (lib/testsync.ts has the layout): Firestore Lite for the small documents (plain
 * server calls, nothing kept in the offline cache, so the study data's cache never grows with tests) and Cloud
 * Storage for the files. Every call goes to the server; offline they fail and the next sync tries again.
 */
import type { Firestore } from "firebase/firestore/lite";
import type { FirebaseStorage } from "firebase/storage";
import { MAX_SETS, type CloudMeta } from "../lib/testsync.ts";

export interface SetsCloud {
  /** The account's sets, from the server. */
  list(): Promise<CloudMeta[]>;
  putFile(id: string, path: string, blob: Blob, onSent?: (bytes: number) => void): Promise<void>;
  getFile(id: string, path: string): Promise<Blob>;
  putMeta(meta: CloudMeta): Promise<void>;
  /** The document first (the set disappears from every device's list), then its files. */
  remove(id: string, files: readonly string[]): Promise<void>;
}

/** The bucket storage.tf creates: named after the project, so no extra build setting is needed. */
export const bucketOf = (projectId: string) => `gs://${projectId}-lexi-testsets`;

export function makeSetsCloud(uid: string, db: Firestore, storage: FirebaseStorage): SetsCloud {
  const lite = import("firebase/firestore/lite");
  const st = import("firebase/storage");
  const folder = (id: string) => `users/${uid}/testsets/${id}`;
  return {
    async list() {
      const { collection, getDocs, limit, query } = await lite;
      const snap = await getDocs(query(collection(db, "users", uid, "testsets"), limit(MAX_SETS)));
      return snap.docs.map((d) => d.data() as CloudMeta);
    },
    async putFile(id, path, blob, onSent) {
      const { ref, uploadBytesResumable } = await st;
      const type = path.endsWith(".json") ? "application/json" : blob.type || "application/octet-stream";
      const task = uploadBytesResumable(ref(storage, `${folder(id)}/${path}`), blob, { contentType: type });
      if (onSent) task.on("state_changed", (s) => onSent(s.bytesTransferred));
      await task;
    },
    async getFile(id, path) {
      const { getBlob, getBytes, ref } = await st;
      const r = ref(storage, `${folder(id)}/${path}`);
      // getBlob keeps the file's type (audio/mpeg…) but exists only in browsers; the emulator tests run in Node.
      return typeof document !== "undefined" ? getBlob(r) : new Blob([await getBytes(r)]);
    },
    async putMeta(meta) {
      const { doc, setDoc } = await lite;
      await setDoc(doc(db, "users", uid, "testsets", meta.id), meta);
    },
    async remove(id, files) {
      const { deleteDoc, doc } = await lite;
      const { deleteObject, ref } = await st;
      await deleteDoc(doc(db, "users", uid, "testsets", id));
      for (const f of files) {
        await deleteObject(ref(storage, `${folder(id)}/${f}`)).catch((e: { code?: string }) => {
          if (e?.code !== "storage/object-not-found") throw e;
        });
      }
    },
  };
}
