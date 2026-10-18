// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { prepareSavedReplay, preloadReplayScreenshots, ReplayUnavailableError, validReplayDuration } from "../savedReplay";
import { replayDebrief, replayTrace } from "./replayFixtures";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const source = { jobName: "saved/job", trialName: "saved trial", duration: 60 };
function completedJob(completed = true) {
  vi.spyOn(api, "getHarborJob").mockResolvedValue({ jobName: source.jobName, trials: [{ trialName: source.trialName, completed }] });
}

describe("replay preparation", () => {
  it("validates the inclusive duration range", () => {
    expect([9, 10, 60, 600, 601, NaN, Infinity].map(validReplayDuration)).toEqual([false, true, true, true, false, false, false]);
  });

  it("retains recorded order, timestamps, persona, outputs and a zero reward", async () => {
    completedJob();
    const raw = replayDebrief();
    const prepared = await prepareSavedReplay(source, raw);
    expect(prepared.run).toBe(raw);
    expect(prepared.run.verifier?.reward).toBe(0);
    expect(prepared.run.createdAt).toBe(raw.createdAt);
    expect(prepared.trace.events.map((event) => event.step)).toEqual([7, 2, 11]);
    expect(raw.webTrace).toEqual(replayTrace);
  });

  it("loads the trace API when the debrief has no events and attaches artifact URLs", async () => {
    completedJob();
    const trace = { events: [{ ...replayTrace.events[0], screenshotFile: "agent/images/step 1.png" }] };
    vi.spyOn(api, "getHarborTrialTrace").mockResolvedValue({ trace });
    vi.stubGlobal("Image", class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const prepared = await prepareSavedReplay(source, replayDebrief({ events: [] }));
    expect(prepared.trace.events[0].screenshotUrl).toBe("/api/harbor/jobs/saved%2Fjob/trials/saved%20trial/screenshots/agent/images/step%201.png");
    expect(trace.events[0]).not.toHaveProperty("screenshotUrl");
  });

  it("rejects empty, unavailable, unfinished and non-web recordings", async () => {
    completedJob();
    vi.spyOn(api, "getHarborTrialTrace").mockResolvedValue({ trace: { events: [] } });
    await expect(prepareSavedReplay(source, replayDebrief({ events: [] }))).rejects.toBeInstanceOf(ReplayUnavailableError);
    vi.mocked(api.getHarborTrialTrace).mockRejectedValue(new Error("Missing artifacts"));
    await expect(prepareSavedReplay(source, replayDebrief({ events: [] }))).rejects.toThrow("Missing artifacts");
    await expect(prepareSavedReplay(source, { ...replayDebrief(), applicationType: "survey" })).rejects.toBeInstanceOf(ReplayUnavailableError);
    vi.mocked(api.getHarborJob).mockResolvedValue({ jobName: source.jobName, trials: [{ trialName: source.trialName, completed: false }] });
    await expect(prepareSavedReplay(source, replayDebrief())).rejects.toBeInstanceOf(ReplayUnavailableError);
  });

  it("settles missing screenshots and cancels pending image callbacks", async () => {
    vi.useFakeTimers();
    const images: { onload: (() => void) | null; onerror: (() => void) | null }[] = [];
    vi.stubGlobal("Image", class {
      onload = null;
      onerror = null;
      constructor() { images.push(this); }
    });
    const trace = { events: [{ ...replayTrace.events[0], screenshotUrl: "/missing.png" }] };
    const loading = preloadReplayScreenshots(trace);
    images[0].onerror?.();
    await loading;
    expect(vi.getTimerCount()).toBe(0);
    const controller = new AbortController();
    const aborted = preloadReplayScreenshots(trace, controller.signal);
    controller.abort();
    await aborted;
    expect(images[1].onload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
