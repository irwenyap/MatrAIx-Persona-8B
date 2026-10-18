import type { PlaygroundResult, WebTrace } from "../types";

export const replayTrace: WebTrace = {
  events: [7, 2, 11].map((step, index) => ({
    step, source: "agent", message: `Recorded message ${index + 1}`,
    actions: [{ name: "click", arguments: { target: `Recorded target ${index + 1}` } }],
  })),
};

export function replayDebrief(trace = replayTrace): PlaygroundResult {
  return {
    id: "harbor-trial", applicationType: "web", createdAt: "2026-10-13T10:00:00Z",
    config: {}, persona: { id: "saved-persona", name: "Saved Persona", context: "Recorded profile" }, transcript: [],
    taskTitle: "Saved task absent from catalog", webTrace: trace,
    webResult: {
      selectedProductId: "developer", selectedProductName: "Developer", needSatisfaction: 0,
      easeOfUse: 4, overallExperienceRating: 5, valid: true, reason: "Recorded reason",
    },
    verifier: { passed: false, reward: 0 },
  };
}
