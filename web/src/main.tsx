import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import "./fonts.ts";
import "./styles.css";
import { LocalRepo } from "./data/local.ts";
import { firebaseConfigured, makeCloudRepo, onUser } from "./data/firebase.ts";
import { startRepo, stopRepo, sync } from "./data/state.ts";
import { useStore } from "./lib/store.ts";
import { App } from "./ui/App.tsx";
import { DeniedGate, LoginGate } from "./ui/Gate.tsx";

interface Who {
  uid: string;
  email: string | null;
}

function Root() {
  // undefined = still checking the saved sign-in
  const [who, setWho] = useState<Who | null | undefined>(firebaseConfigured ? undefined : null);
  const s = useStore(sync);

  useEffect(() => {
    if (!firebaseConfigured) {
      void startRepo(new LocalRepo());
      return;
    }
    let off = () => {};
    void onUser((u) => setWho(u ? { uid: u.uid, email: u.email } : null)).then((f) => (off = f));
    return () => off();
  }, []);

  useEffect(() => {
    if (!firebaseConfigured) return;
    if (who) void makeCloudRepo(who.uid).then((r) => startRepo(r));
    else if (who === null) stopRepo();
  }, [who?.uid]);

  if (firebaseConfigured) {
    if (who === undefined) return <LoginGate busy />;
    if (who === null) return <LoginGate busy={false} />;
    if (s === "denied") return <DeniedGate email={who.email} />;
  }
  return <App email={who?.email ?? null} />;
}

render(<Root />, document.getElementById("app")!);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  addEventListener("load", () => void navigator.serviceWorker.register("/sw.js").catch(() => undefined));
}
