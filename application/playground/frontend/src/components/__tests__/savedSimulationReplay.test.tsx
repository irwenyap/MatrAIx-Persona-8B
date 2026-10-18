// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { I18nProvider } from "@/i18n/I18nProvider";
import { replayDebrief, replayTrace } from "@/lib/__tests__/replayFixtures";
import { HarborTraceReplay } from "../cockpit/HarborTraceReplay";
import { SavedSimulationReplay } from "../SavedSimulationReplay";
import { asRunDetail } from "../runsShared";

const jobName = "saved-job";
const trialName = "saved-trial";
const trialPath = `/api/harbor/jobs/${jobName}/trials/${trialName}`;
const resultsUrl = `/?view=runs&harborJob=${jobName}&harborTrial=${trialName}`;
let requests: { path: string; method: string }[];
let client: QueryClient;
let raw = replayDebrief();
let completed = true;

async function settle(ms = 20) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

function mountApp() {
  return render(<StrictMode><I18nProvider><QueryClientProvider client={client}><App /></QueryClientProvider></I18nProvider></StrictMode>);
}

async function openPicker() {
  await vi.waitFor(() => {
    expect((screen.getByRole("button", { name: /Replay in Playground/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  fireEvent.click(screen.getByRole("button", { name: /Replay in Playground/ }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"] });
  window.localStorage.clear();
  window.history.replaceState(null, "", resultsUrl);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  raw = replayDebrief();
  completed = true;
  requests = [];
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  vi.stubGlobal("fetch", vi.fn(async (path: string, init?: RequestInit) => {
    requests.push({ path, method: init?.method ?? "GET" });
    let data: unknown;
    if (path === "/api/config/options") data = {};
    else if (path === "/api/preflight") data = { ready: true, checks: [] };
    else if (path === "/api/harbor/jobs") data = { jobs: [] };
    else if (path === `/api/harbor/jobs/${jobName}`) data = { jobName, trials: [{ trialName, completed }] };
    else if (path === `${trialPath}/debrief`) data = raw;
    else if (path === `${trialPath}/trace`) data = { trace: raw.webTrace };
    else throw new Error(`Unexpected replay request: ${path}`);
    return { ok: true, text: async () => JSON.stringify(data) };
  }));
});

afterEach(() => {
  cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("saved simulation replay", () => {
  it("starts from results, replaces the center, reveals in recorded order, and returns to the same trial", async () => {
    mountApp();
    await settle();
    await openPicker();
    const duration = screen.getByLabelText("Duration (seconds)") as HTMLInputElement;
    expect(duration.value).toBe("60");
    fireEvent.change(duration, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Start replay" }));
    await settle();
    expect(new URLSearchParams(window.location.search).get("replayDuration")).toBe("10");
    const replay = screen.getByRole("region", { name: "Recorded replay" });
    expect(within(replay).getByRole("heading", { name: "Saved task absent from catalog" })).toBeTruthy();
    expect(within(replay).getByText("Saved Persona")).toBeTruthy();
    const explanation = screen.getByRole("complementary", { name: "Explanation" });
    expect(within(explanation).getByText("Recorded message 1")).toBeTruthy();
    expect(within(explanation).queryByText("Recorded message 2")).toBeNull();
    expect(within(replay).queryByText("Recorded message 1")).toBeNull();
    expect(screen.queryByText("reward 0")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Evaluation" })).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(within(replay).queryByText(/\d+\s*\/\s*10\s*s/)).toBeNull();
    expect(within(replay).getByRole("button", { name: "Stop" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Run Live/i }).closest("fieldset")?.disabled).toBe(true);
    fireEvent.keyDown(document, { key: "r" });
    await settle(3400);
    expect(within(explanation).getByText("Recorded message 2")).toBeTruthy();
    expect(within(explanation).queryByText("Recorded message 1")).toBeNull();
    expect(within(explanation).queryByText("Recorded message 3")).toBeNull();
    await settle(3400);
    expect(within(explanation).getByText("Recorded message 3")).toBeTruthy();
    await settle(3100);
    expect(screen.getByRole("region", { name: "Recorded replay" })).toBeTruthy();
    await settle(100);
    expect(screen.queryByRole("region", { name: "Recorded replay" })).toBeNull();
    const url = new URLSearchParams(window.location.search);
    expect(url.get("harborJob")).toBe(jobName);
    expect(url.get("harborTrial")).toBe(trialName);
    expect(url.has("replayJob")).toBe(false);
    expect(url.has("replayTrial")).toBe(false);
    expect(url.has("replayDuration")).toBe(false);
    const stored = JSON.parse(window.localStorage.getItem("playground.urlState") ?? "{}");
    expect(stored).not.toHaveProperty("replayJob");
    expect(stored).not.toHaveProperty("replayTrial");
    expect(stored).not.toHaveProperty("replayDuration");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.filter(({ path }) => /\/(live|events|status|cancel|launch)(\?|$)/.test(path))).toEqual([]);
    expect(requests.filter(({ path }) => path.includes("-eval/tasks"))).toEqual([]);
  });

  it("refreshes into ready state, ignores live run pointers, and requires explicit start", async () => {
    window.history.replaceState(null, "", `/?mode=playground&replayJob=${jobName}&replayTrial=${trialName}&replayDuration=10&cockpitJob=unrelated&cockpitTrial=unrelated`);
    mountApp();
    await settle();
    expect(screen.getByText("Ready to replay for 10 seconds. Select Start replay to begin.")).toBeTruthy();
    await settle(20_000);
    expect(screen.queryByText("Recorded message 1")).toBeNull();
    expect(screen.getByRole("button", { name: "Start replay" })).toBeTruthy();
    expect(requests.some(({ path }) => path.includes("unrelated"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Start replay" }));
    await settle(10_000);
    expect(new URLSearchParams(window.location.search).get("harborTrial")).toBe(trialName);
  });

  it("stops early and never completes again after unmount", async () => {
    const onReturn = vi.fn();
    const source = { jobName, trialName, duration: 10 };
    const view = render(<I18nProvider><SavedSimulationReplay source={source}
      initial={{ ...source, run: asRunDetail(raw), trace: replayTrace }} options={null} onReturn={onReturn} /></I18nProvider>);
    await settle(500);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(onReturn).toHaveBeenCalledTimes(1);
    view.unmount();
    await settle(20_000);
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(requests).toEqual([]);
  });

  it("validates duration and finishes image preparation before navigating or starting the countdown", async () => {
    const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      onload = null;
      onerror = null;
      constructor() { images.push(this); }
    });
    raw = replayDebrief({ events: [{ ...replayTrace.events[0], screenshotFile: "agent/images/saved.png" }] });
    mountApp(); await settle();
    await openPicker();
    const duration = screen.getByLabelText("Duration (seconds)");
    for (const value of ["9", "601", ""]) {
      fireEvent.change(duration, { target: { value } });
      expect((screen.getByRole("button", { name: "Start replay" }) as HTMLButtonElement).disabled).toBe(true);
    }
    fireEvent.change(duration, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Start replay" }));
    await settle(5000);
    expect(window.location.search).toBe(resultsUrl.slice(1));
    expect(screen.getByRole("button", { name: "Preparing saved trace and screenshots…" })).toBeTruthy();
    expect(images.length).toBe(1);
    images[0].onload?.();
    await settle();
    expect(screen.getByRole("region", { name: "Recorded replay" })).toBeTruthy();
    await settle(9900);
    expect(screen.getByRole("region", { name: "Recorded replay" })).toBeTruthy();
    await settle(100);
    expect(new URLSearchParams(window.location.search).get("harborTrial")).toBe(trialName);
  });

  it("cancels screenshot preparation when the picker closes", async () => {
    const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      onload = null;
      onerror = null;
      constructor() { images.push(this); }
    });
    raw = replayDebrief({ events: [{ ...replayTrace.events[0], screenshotUrl: "/pending.png" }] });
    mountApp(); await settle();
    await openPicker();
    fireEvent.click(screen.getByRole("button", { name: "Start replay" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await settle(20_000);
    expect(images[0].onload).toBeNull();
    expect(window.location.search).toBe(resultsUrl.slice(1));
    expect(screen.queryByRole("region", { name: "Recorded replay" })).toBeNull();
  });

  it("cancels playback when navigation leaves Playground", async () => {
    window.history.replaceState(null, "", `/?mode=playground&replayJob=${jobName}&replayTrial=${trialName}&replayDuration=10`);
    mountApp(); await settle();
    fireEvent.click(screen.getByRole("button", { name: "Start replay" }));
    await settle(1000);
    // Browser navigation away must also cancel the monotonic deadline.
    act(() => {
      window.history.replaceState(null, "", "/?view=runs");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await settle(20_000);
    expect(window.location.search).toBe("?view=runs");
    expect(screen.queryByRole("region", { name: "Recorded replay" })).toBeNull();
  });

  it("prevents playback for missing traces and unfinished trials with recovery guidance", async () => {
    raw = replayDebrief({ events: [] });
    mountApp(); await settle();
    expect(screen.getByRole("button", { name: /Replay in Playground/ }).hasAttribute("disabled")).toBe(true);
    await vi.waitFor(() => expect(screen.getByText(/Check that the backend and saved artifacts are available/)).toBeTruthy());
    cleanup(); client.clear();
    raw = replayDebrief(); completed = false;
    mountApp(); await settle();
    expect(screen.getByRole("button", { name: /Replay in Playground/ }).hasAttribute("disabled")).toBe(true);
    completed = true;
    fireEvent.click(screen.getByRole("button", { name: /Refresh/ }));
    await openPicker();
    expect(screen.getByLabelText("Duration (seconds)")).toBeTruthy();
  });

  it("follows the last revealed screenshot across message-only events and shows missing-image fallback", () => {
    const trace = { events: [
      { ...replayTrace.events[0], screenshotUrl: "/saved.png" },
      replayTrace.events[1],
      { ...replayTrace.events[2], screenshotUrl: "/missing.png" },
    ] };
    const view = render(<I18nProvider><HarborTraceReplay trace={trace} revealedCount={2} /></I18nProvider>);
    const hero = screen.getByRole("img", { name: "Step 7" });
    expect(hero.getAttribute("src")).toBe("/saved.png");
    expect(screen.getByText("Recorded message 2")).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
    view.rerender(<I18nProvider><HarborTraceReplay trace={trace} revealedCount={3} /></I18nProvider>);
    fireEvent.error(screen.getByRole("img", { name: "Step 11" }));
    expect(screen.getByText(/Screenshot unavailable/)).toBeTruthy();
  });
});
