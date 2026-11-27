export type WorkspacePage = "laboratory" | "curriculum" | "projectiles" | "challenges";

const pageHashes: Readonly<Record<WorkspacePage, string>> = {
  laboratory: "#/lab",
  curriculum: "#/curriculum",
  projectiles: "#/curriculum/projectiles",
  challenges: "#/challenges"
};

interface NavigationBrowser {
  readonly location: Pick<Location, "hash">;
  readonly history: Pick<History, "pushState" | "replaceState" | "state">;
  addEventListener(type: "popstate" | "hashchange", listener: () => void): void;
  removeEventListener(type: "popstate" | "hashchange", listener: () => void): void;
}

// Browser history stores page locations only; the mounted editor keeps authored work.
export function createWorkspaceNavigation(browser: NavigationBrowser) {
  const listeners = new Set<() => void>();
  const getSnapshot = (): WorkspacePage => {
    const hash = browser.location.hash.replace(/\/$/, "");
    if (hash === pageHashes.projectiles) return "projectiles";
    if (hash === pageHashes.challenges) return "challenges";
    if (hash === pageHashes.curriculum) return "curriculum";
    return "laboratory";
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot,
    navigate(page: WorkspacePage): void {
      if (browser.location.hash === pageHashes[page]) return;
      browser.history.pushState(browser.history.state, "", pageHashes[page]);
      notify();
    },
    subscribe(listener: () => void): () => void {
      if (listeners.size === 0) {
        if (browser.location.hash === "") {
          browser.history.replaceState(browser.history.state, "", pageHashes.laboratory);
        }
        browser.addEventListener("popstate", notify);
        browser.addEventListener("hashchange", notify);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          browser.removeEventListener("popstate", notify);
          browser.removeEventListener("hashchange", notify);
        }
      };
    },
  };
}
