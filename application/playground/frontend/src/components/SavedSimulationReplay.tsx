import { memo, useEffect, useRef, useState } from "react";

import { useI18n } from "@/i18n/I18nProvider";
import { prepareSavedReplay, type PreparedReplay, type ReplaySource } from "@/lib/savedReplay";
import { useReplayClock } from "@/lib/useReplayClock";
import type { ConfigOptionsResponse } from "@/lib/types";
import { PlaygroundCockpit } from "./cockpit/PlaygroundCockpit";
import { HarborTraceReplay, HarborTraceStepDetail } from "./cockpit/HarborTraceReplay";
import { FOCUS_RING } from "./cockpit/cockpitShared";

// Progress updates should not rebuild the full trace grid between events.
const TimedTraceReplay = memo(HarborTraceReplay);

export interface SavedSimulationReplayProps {
  source: ReplaySource;
  initial?: PreparedReplay;
  options: ConfigOptionsResponse | null;
  onReturn: () => void;
}

export function SavedSimulationReplay({ source, initial, options, onReturn }: SavedSimulationReplayProps) {
  const { t } = useI18n();
  const [prepared, setPrepared] = useState(initial);
  const [phase, setPhase] = useState<"preparing" | "ready" | "playing" | "error">(initial ? "playing" : "preparing");
  const [attempt, setAttempt] = useState(0);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setPhase("ready");
    onReturn();
  };
  const clock = useReplayClock(phase === "playing", source.duration, prepared?.trace.events.length ?? 0, finish);

  useEffect(() => {
    if (initial) return;
    const controller = new AbortController();
    setPhase("preparing");
    void prepareSavedReplay(source, undefined, controller.signal).then((replay) => {
      if (controller.signal.aborted) return;
      setPrepared(replay);
      setPhase("ready");
    }).catch(() => {
      if (!controller.signal.aborted) setPhase("error");
    });
    return () => controller.abort();
  }, [source.jobName, source.trialName, source.duration, initial, attempt]);

  const run = prepared?.run;
  const activeEvent = phase === "playing" ? prepared?.trace.events[clock.revealedCount - 1] : undefined;
  return <PlaygroundCockpit options={options} onOpenRuns={finish} replayRun={run}
    replayExplanation={activeEvent && <div key={activeEvent.step} className="custom-scrollbar h-full overflow-y-auto p-3">
      <HarborTraceStepDetail event={activeEvent} />
    </div>}
    replayCenter={<section className="space-y-3 p-3" aria-label={t("replay.recorded")}>
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-outline bg-surface p-4">
        <div className="min-w-0">
          <span className="hud text-[11px] text-primary">{t("replay.recorded")}</span>
          <h2 className="mt-1 font-display text-lg font-semibold">{run?.taskTitle || source.trialName}</h2>
          <p className="text-sm text-text-variant">{run?.persona?.name || run?.persona?.id}</p>
          <p className="break-all font-mono text-xs text-text-dim">{source.jobName} · {source.trialName}</p>
          {run?.createdAt && <time className="text-xs text-text-dim" dateTime={run.createdAt}>{run.createdAt}</time>}
        </div>
        <button type="button" onClick={finish} className={`rounded border border-outline px-3 py-2 text-sm ${FOCUS_RING}`}>{t("replay.stop")}</button>
      </div>
      {phase === "preparing" && <p role="status">{t("replay.preparing")}</p>}
      {phase === "error" && <div role="alert" className="space-y-3 text-sm">
        <p>{t("replay.unavailable")}</p>
        <button type="button" onClick={() => setAttempt((value) => value + 1)} className={`rounded border border-outline px-3 py-2 ${FOCUS_RING}`}>{t("cockpit.trajectory.retry")}</button>
      </div>}
      {phase === "ready" && <div className="space-y-3">
        <p className="text-sm text-text-variant">{t("replay.ready", { seconds: source.duration })}</p>
        <button type="button" onClick={() => setPhase("playing")} className={`rounded bg-primary px-4 py-2 text-on-primary ${FOCUS_RING}`}>{t("replay.start")}</button>
      </div>}
      {phase === "playing" && prepared && <TimedTraceReplay trace={prepared.trace} revealedCount={clock.revealedCount} hideStepDetail />}
    </section>}
  />;
}
