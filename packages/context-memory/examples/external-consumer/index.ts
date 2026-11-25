import type { SourcePreviewPort, RequestControls } from "../../src/index";
/** Ordinary application code: dependencies and scope are injected by its own composition. */
export async function selectNotebookNotes(
  engine: SourcePreviewPort,
  note: { id: string; revision: string; text: string },
  controls: RequestControls,
) {
  const result = await engine.preview(
    {
      scope: "notebook-notes",
      source: { id: note.id, revision: note.revision, body: note.text },
      maxStatements: 4,
    },
    controls,
  );
  if (result.status !== "complete") return { state: "unavailable" as const };
  return {
    state: "selected" as const,
    notes: result.statements.map((statement) => statement.body),
  };
}
