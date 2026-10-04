import {
  verifyCandidateRevision,
  type AgentReference,
  type Selection,
} from "@causign/runtime";
export async function createCodexLaunch(
  selection: Selection,
): Promise<AgentReference> {
  if (
    selection.adapterId !== "causign/codex-output" ||
    selection.candidate.discovererId !== "causign/codex-config"
  )
    throw new Error("Invalid Codex selection");
  await verifyCandidateRevision(selection.candidate);
  throw new Error(
    "Codex output execution unavailable until global tool denial is verified; native model execution was not launched",
  );
}
