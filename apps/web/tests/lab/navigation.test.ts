// Check page history with a small stand-in for the browser, so Back and Forward are covered without a DOM.
import { expect, it, vi } from "vitest";
import { createWorkspaceNavigation } from "../../src/navigation.js";

function createFakeBrowser(initialHash: string) {
  const entries = [initialHash];
  let index = 0;
  const listeners = new Map<string, Set<() => void>>();
  const emit = (type: string) => listeners.get(type)?.forEach((listener) => listener());

  return {
    location: { get hash() { return entries[index] ?? ""; } },
    history: {
      state: null,
      pushState: (_state: unknown, _title: string, url: string) => {
        entries.splice(index + 1);
        entries.push(url);
        index += 1;
      },
      replaceState: (_state: unknown, _title: string, url: string) => { entries[index] = url; },
    },
    addEventListener: (type: string, listener: () => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: () => void) => { listeners.get(type)?.delete(listener); },
    // The browser's Back and Forward buttons move through entries and report a popstate.
    go(delta: number) {
      index += delta;
      emit("popstate");
    },
  };
}

it("moves Back and Forward through the pages visited, notifying subscribers each time", () => {
  const browser = createFakeBrowser("");
  const navigation = createWorkspaceNavigation(browser as never);
  const listener = vi.fn();
  navigation.subscribe(listener);

  expect(navigation.getSnapshot()).toBe("laboratory");
  navigation.navigate("curriculum");
  navigation.navigate("projectiles");
  expect(navigation.getSnapshot()).toBe("projectiles");

  browser.go(-1);
  expect(navigation.getSnapshot()).toBe("curriculum");
  browser.go(-1);
  expect(navigation.getSnapshot()).toBe("laboratory");
  browser.go(1);
  expect(navigation.getSnapshot()).toBe("curriculum");
  expect(listener).toHaveBeenCalledTimes(5);
});

it("does not add a history entry when the current page is requested again", () => {
  const browser = createFakeBrowser("#/lab");
  const navigation = createWorkspaceNavigation(browser as never);
  navigation.subscribe(() => {});
  navigation.navigate("curriculum");
  navigation.navigate("curriculum");
  // A duplicate entry would make one Back press land on the curriculum again.
  browser.go(-1);
  expect(navigation.getSnapshot()).toBe("laboratory");
});
