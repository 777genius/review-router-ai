import assert from "node:assert/strict";

/** Admit only the two imports emitted by Next in this run's exact types directory. */
export function restoreOwnedNextEnv(
  original: string,
  current: string,
  ownedTypesDirectory: string,
): string {
  let normalized = current;
  for (const name of ["routes.d.ts", "root-params.d.ts"]) {
    const originalImport = original
      .split(/\r?\n/u)
      .find(
        (line) =>
          line.startsWith('import "') && line.endsWith(`/types/${name}";`),
      );
    if (originalImport === undefined) continue;
    const ownedImport = `import "${ownedTypesDirectory}/${name}";`;
    normalized = normalized
      .split("\n")
      .map((line) => {
        if (line === ownedImport) return originalImport;
        if (line === `${ownedImport}\r`) return `${originalImport}\r`;
        return line;
      })
      .join("\n");
  }
  assert.equal(
    normalized,
    original,
    "Next metadata changed outside this owned run; refusing overwrite",
  );
  return original;
}
