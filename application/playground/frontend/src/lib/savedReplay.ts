import { api } from "./api";
import { attachHarborTraceScreenshotUrls } from "./harborCockpitMappers";
import type { PlaygroundResult, WebTrace } from "./types";
import { asRunDetail, runApplicationType, runWebTrace, type RunDetailView } from "@/components/runsShared";

export interface ReplaySource {
  jobName: string;
  trialName: string;
  duration: number;
}

export interface PreparedReplay extends ReplaySource {
  run: RunDetailView;
  trace: WebTrace;
}

export class ReplayUnavailableError extends Error {}

export function validReplayDuration(value: number): boolean {
  return Number.isFinite(value) && value >= 10 && value <= 600;
}

/** Snapshot reads only: replay never enters the live execution lifecycle. */
export async function prepareSavedReplay(
  source: ReplaySource,
  debrief?: PlaygroundResult,
  signal?: AbortSignal,
): Promise<PreparedReplay> {
  if (!validReplayDuration(source.duration)) throw new ReplayUnavailableError();
  const [raw, job] = await Promise.all([
    debrief ?? api.getHarborTrialDebrief(source.jobName, source.trialName),
    api.getHarborJob(source.jobName),
  ]);
  signal?.throwIfAborted();
  const trial = job.trials.find((item) => item.trialName === source.trialName);
  const run = asRunDetail(raw);
  if (!trial?.completed || runApplicationType(run) !== "web") throw new ReplayUnavailableError();
  const savedTrace = runWebTrace(run);
  const rawTrace = savedTrace?.events.length
    ? savedTrace
    : (await api.getHarborTrialTrace(source.jobName, source.trialName)).trace;
  signal?.throwIfAborted();
  const trace = attachHarborTraceScreenshotUrls(rawTrace, source.jobName, source.trialName);
  if (!trace?.events.length) throw new ReplayUnavailableError();
  // Keep the original sequence, including message-only events and zero verifier scores.
  await preloadReplayScreenshots(trace, signal);
  signal?.throwIfAborted();
  return { ...source, run, trace };
}

/** Failed images settle too, allowing the existing screenshot fallback to render. */
export async function preloadReplayScreenshots(trace: WebTrace, signal?: AbortSignal): Promise<void> {
  const urls = [...new Set(trace.events.flatMap((event) => event.screenshotUrl ? [event.screenshotUrl] : []))];
  let next = 0;
  // Bound simultaneous image loads for long recordings.
  await Promise.all(Array.from({ length: Math.min(6, urls.length) }, async () => {
    while (next < urls.length && !signal?.aborted) {
      const url = urls[next++];
      await new Promise<void>((resolve) => {
        const img = new Image();
        const finish = () => {
          window.clearTimeout(timeout);
          img.onload = img.onerror = null;
          signal?.removeEventListener("abort", finish);
          resolve();
        };
        const timeout = window.setTimeout(finish, 15_000);
        img.onload = img.onerror = finish;
        signal?.addEventListener("abort", finish, { once: true });
        img.src = url;
      });
    }
  }));
}
