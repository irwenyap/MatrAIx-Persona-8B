import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";

import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";
import { prepareSavedReplay, validReplayDuration, type PreparedReplay } from "@/lib/savedReplay";
import type { PlaygroundResult } from "@/lib/types";
import { asRunDetail, runWebTrace } from "./runsShared";
import { StudioToolbarButton } from "./studio/StudioShell";
import { FOCUS_RING } from "./cockpit/cockpitShared";

export interface ReplayLaunchButtonProps {
  jobName: string;
  trialName: string;
  debrief: PlaygroundResult;
  onPrepared: (replay: PreparedReplay) => void;
}

export function ReplayLaunchButton(props: ReplayLaunchButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const job = useQuery({
    queryKey: ["saved-replay-job", props.jobName],
    queryFn: () => api.getHarborJob(props.jobName),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const embeddedTrace = runWebTrace(asRunDetail(props.debrief));
  const trace = useQuery({
    queryKey: ["saved-replay-trace", props.jobName, props.trialName],
    queryFn: () => api.getHarborTrialTrace(props.jobName, props.trialName),
    enabled: !embeddedTrace?.events.length,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const completed = job.data?.trials.find((trial) => trial.trialName === props.trialName)?.completed;
  const hasTrace = Boolean(embeddedTrace?.events.length || trace.data?.trace.events.length);
  const pending = job.isPending || (!embeddedTrace?.events.length && trace.isPending);
  const unavailable = !pending && (!completed || !hasTrace);
  return <>
    <StudioToolbarButton icon="play_circle" disabled={pending || unavailable} onClick={() => setOpen(true)}>
      {t("replay.open")}
    </StudioToolbarButton>
    {unavailable && <span className="max-w-xs text-[12px] text-text-variant" role="status">{t("replay.unavailable")}</span>}
    {open && <ReplayDurationDialog {...props} onClose={() => setOpen(false)} />}
  </>;
}

function ReplayDurationDialog({ jobName, trialName, debrief, onPrepared, onClose }: ReplayLaunchButtonProps & { onClose: () => void }) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef(new AbortController());
  const [duration, setDuration] = useState("60");
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = dialog.current;
    controller.current = new AbortController();
    panel?.showModal();
    return () => {
      controller.current.abort();
      panel?.close();
      previouslyFocused?.focus();
    };
  }, []);

  return createPortal(
    <dialog ref={dialog} aria-labelledby="replay-duration-title" aria-describedby="replay-duration-description" onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="w-full max-w-md rounded-xl border border-outline bg-surface p-5 text-text-main shadow-2xl backdrop:bg-black/60">
      <form className="space-y-4" onSubmit={async (event) => {
        event.preventDefault();
        if (preparing || !validReplayDuration(Number(duration))) return;
        setPreparing(true);
        setError(false);
        const signal = controller.current.signal;
        try {
          const prepared = await prepareSavedReplay({ jobName, trialName, duration: Number(duration) }, debrief, signal);
          if (!signal.aborted) onPrepared(prepared);
        } catch {
          if (!signal.aborted) { setError(true); setPreparing(false); }
        }
      }}>
        <h2 id="replay-duration-title" className="font-display text-lg font-semibold">{t("replay.open")}</h2>
        <p id="replay-duration-description" className="text-sm text-text-variant">{t("replay.description")}</p>
        <label className="block text-sm">
          {t("replay.duration")}
          <input type="number" min={10} max={600} step="any" required value={duration} disabled={preparing}
            onChange={(event) => setDuration(event.target.value)} className={`mt-2 block w-full rounded border border-outline bg-field p-2 ${FOCUS_RING}`} />
        </label>
        {error && <p role="alert" className="text-sm text-danger">{t("replay.unavailable")}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className={`rounded border border-outline px-3 py-2 ${FOCUS_RING}`}>{t("replay.cancel")}</button>
          <button type="submit" disabled={preparing || !validReplayDuration(Number(duration))} className={`rounded bg-primary px-3 py-2 text-on-primary disabled:opacity-50 ${FOCUS_RING}`}>
            {preparing ? t("replay.preparing") : t("replay.start")}
          </button>
        </div>
      </form>
    </dialog>, document.body,
  );
}
