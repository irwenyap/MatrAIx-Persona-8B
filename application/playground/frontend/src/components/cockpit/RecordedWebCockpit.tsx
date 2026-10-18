import type { ReactNode } from "react";

import { useI18n } from "@/i18n/I18nProvider";
import type { RunDetailView } from "../runsShared";
import { TrialDebriefRails } from "../TrialDebriefRails";
import { CockpitSetupShell } from "./setup/CockpitSetupShell";
import { RunHeader } from "./RunHeader";
import { RunLaunchBar } from "./setup/RunLaunchBar";

/** Recorded rails use saved artifacts, including when the catalog task is gone. */
export function RecordedWebCockpit({ run, center, explanation }: { run?: RunDetailView; center: ReactNode; explanation?: ReactNode }) {
  const { t } = useI18n();
  return <CockpitSetupShell
    header={<RunHeader taskType="web" onTaskTypeChange={() => {}} disabled />}
    left={<div className="custom-scrollbar h-full overflow-auto rounded-xl border border-outline bg-surface-low">
      <div className="border-b border-outline p-4">
        <p className="hud text-xs text-primary">{t("runs.personaProfile")}</p>
        <p className="mt-2 font-display font-semibold">{run?.persona?.name || run?.persona?.id}</p>
      </div>
      <TrialDebriefRails persona={run?.persona} />
    </div>}
    center={<div className="flex h-full min-h-0 flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-auto">{center}</div>
      <fieldset disabled className="shrink-0">
        <RunLaunchBar canRun={false} isBatch={false} personaCount={1} parallelTrials={1} onParallelTrialsChange={() => {}} isRunning={false} onRun={() => {}} />
      </fieldset>
    </div>}
    right={<aside aria-label={t("reports.facet.explanation")} className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-outline bg-surface-lowest">
      <div className="hud shrink-0 border-b border-outline bg-surface px-4 py-3 text-xs text-primary">{t("reports.facet.explanation")}</div>
      <div className="min-h-0 flex-1">{explanation}</div>
    </aside>}
  />;
}
