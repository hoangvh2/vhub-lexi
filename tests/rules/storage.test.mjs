// Run with: npm run rules   (starts the Storage emulator, loads storage.rules generated for owner@example.com)
import { readFileSync } from "node:fs";
import { after, before, beforeEach, describe, it } from "node:test";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteObject, getBytes, listAll, ref, uploadBytes } from "firebase/storage";

const rules = readFileSync(new URL("../../storage.rules", import.meta.url), "utf8");

let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-lexi", storage: { rules, host: "127.0.0.1", port: 9199 } });
});
after(async () => env?.cleanup());
beforeEach(async () => env.clearStorage());

const claims = (email, extra = {}) => ({ email, email_verified: true, firebase: { sign_in_provider: "google.com" }, ...extra });
const as = (uid, c = claims("owner@example.com")) => env.authenticatedContext(uid, c).storage();
const me = () => as("alice");
const SET = "0b9c6f1e-2f43-4a3a-9d0e-7a1c2b3d4e5f";
const at = (s, p) => ref(s, `users/alice/testsets/${SET}/${p}`);
const json = new TextEncoder().encode('{"questions":[]}');
const bytes = (n) => new Uint8Array(n);

describe("Bộ đề files: the owner's own folder only", () => {
  it("the owner uploads, reads back and deletes the questions, audio and pictures", async () => {
    const s = me();
    await assertSucceeds(uploadBytes(at(s, "set.json"), json, { contentType: "application/json" }));
    await assertSucceeds(uploadBytes(at(s, "media/a0"), bytes(2048), { contentType: "audio/mpeg" }));
    await assertSucceeds(uploadBytes(at(s, "media/a12"), bytes(16), { contentType: "application/octet-stream" }));
    await assertSucceeds(uploadBytes(at(s, "media/p3"), bytes(512), { contentType: "image/jpeg" }));
    await assertSucceeds(getBytes(at(s, "set.json")));
    await assertSucceeds(getBytes(at(s, "media/a0")));
    await assertSucceeds(deleteObject(at(s, "media/a0")));
    await assertSucceeds(deleteObject(at(s, "set.json")));
  });
  it("nobody else: another uid, a stranger, unverified, password sign-in, signed out", async () => {
    await assertSucceeds(uploadBytes(at(me(), "set.json"), json, { contentType: "application/json" }));
    const others = [
      as("bob"),
      as("alice", claims("stranger@example.com")),
      as("alice", claims("owner@example.com", { email_verified: false })),
      as("alice", claims("owner@example.com", { firebase: { sign_in_provider: "password" } })),
      env.unauthenticatedContext().storage(),
    ];
    for (const s of others) {
      await assertFails(getBytes(at(s, "set.json")));
      await assertFails(uploadBytes(at(s, "media/a0"), bytes(8), { contentType: "audio/mpeg" }));
      await assertFails(deleteObject(at(s, "set.json")));
    }
  });
  it("rejects other names, types, folders and listing", async () => {
    const s = me();
    await assertFails(uploadBytes(at(s, "test.pdf"), bytes(8), { contentType: "application/pdf" }));
    await assertFails(uploadBytes(at(s, "set.json"), json, { contentType: "text/html" }));
    await assertFails(uploadBytes(at(s, "media/x1"), bytes(8), { contentType: "audio/mpeg" }));
    await assertFails(uploadBytes(at(s, "media/a0"), bytes(8), { contentType: "text/html" }));
    await assertFails(uploadBytes(ref(s, `users/alice/testsets/a b/set.json`), json, { contentType: "application/json" }));
    await assertFails(uploadBytes(ref(s, "users/alice/other/file"), bytes(8), { contentType: "image/png" }));
    await assertFails(uploadBytes(ref(s, "public/file"), bytes(8), { contentType: "image/png" }));
    await assertFails(listAll(ref(s, `users/alice/testsets/${SET}`)));
  });
  it("set.json is capped at 5 MB", async () => {
    await assertFails(uploadBytes(at(me(), "set.json"), bytes(5 * 1024 * 1024 + 1), { contentType: "application/json" }));
  });
});
