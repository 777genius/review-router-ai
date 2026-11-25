export type ArchitectureViolation = Readonly<{
  file: string;
  imported: string;
  reason: string;
}>;

export type ArchitectureCheckResult = Readonly<{
  checkedFiles: number;
  violations: readonly ArchitectureViolation[];
}>;
