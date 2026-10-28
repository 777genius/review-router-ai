export type ReviewLifecycleTargetWitness = Readonly<{
  targetId: string;
  threadId: string;
  fingerprint: string;
  parentId: string;
  parentCreatedAt: string;
  parentUpdatedAt: string;
  parentBodyHash: string;
  claimHash: string;
  commentStateHash: string;
  ledgerWatermark: string;
  originalPath: string | null;
  currentPath: string | null;
  originalLine: number | null;
  currentLine: number | null;
  severity: "critical" | "major" | "minor" | "unknown";
  resolutionHistory: Readonly<{
    historyCut: string;
    guardVersion: string;
    state:
      | "no_prior_since_creation"
      | "before_cut_unobserved"
      | "previously_resolved"
      | "effect_unknown"
      | "unavailable";
  }>;
}>;
export type ReviewLifecycleAssignmentPlan = Readonly<{
  version: 1;
  capabilityHash: string;
  descriptorDigest: string;
  policyDigest: string;
  inventoryHash: string;
  inventoryCount: number;
  dispositionCounts: Readonly<
    Record<
      | "eligible"
      | "manual"
      | "unsupported"
      | "capped"
      | "unavailable"
      | "resolved",
      number
    >
  >;
  participantRoster: readonly Readonly<{ providerVoteIdentityHash: string }>[];
  targets: readonly ReviewLifecycleTargetWitness[];
  assignments: readonly Readonly<{
    workSlotId: string;
    packetHash: string;
    targetIds: readonly string[];
    lifecycleTargetSetHash: string;
    liveLifecycleStateHash: string;
  }>[];
}>;

/** Structural ownership/accounting only. Captured capability authority is checked at the API boundary. */
export function validateReviewLifecycleAssignmentPlan(
  value: unknown,
  fileAssignments: readonly Readonly<{
    workSlotId: string;
    paths: readonly string[];
  }>[],
  knownWorkSlotIds: readonly string[],
): ReviewLifecycleAssignmentPlan {
  const plan = row(value);
  exact(plan, [
    "version",
    "capabilityHash",
    "descriptorDigest",
    "policyDigest",
    "inventoryHash",
    "inventoryCount",
    "dispositionCounts",
    "participantRoster",
    "targets",
    "assignments",
  ]);
  if (plan.version !== 1) fail("version");
  for (const name of ["capabilityHash", "policyDigest", "inventoryHash"])
    hash(plan[name]);
  if (
    typeof plan.descriptorDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(plan.descriptorDigest)
  )
    fail("descriptor");
  integer(plan.inventoryCount);
  const counts = row(plan.dispositionCounts);
  exact(counts, [
    "eligible",
    "manual",
    "unsupported",
    "capped",
    "unavailable",
    "resolved",
  ]);
  for (const count of Object.values(counts)) integer(count);
  if (
    Object.values(counts).reduce<number>((sum, n) => sum + Number(n), 0) !==
    plan.inventoryCount
  )
    fail("accounting");
  if (
    !Array.isArray(plan.participantRoster) ||
    plan.participantRoster.length !== 1
  )
    fail("roster");
  const participant = row(plan.participantRoster[0]);
  exact(participant, ["providerVoteIdentityHash"]);
  hash(participant.providerVoteIdentityHash);
  if (
    !Array.isArray(plan.targets) ||
    plan.targets.length > 8 ||
    plan.targets.length > Number(counts.eligible)
  )
    fail("targets");
  const targetIds = new Set<string>();
  for (const value of plan.targets) {
    const target = row(value);
    exact(target, [
      "targetId",
      "threadId",
      "fingerprint",
      "parentId",
      "parentCreatedAt",
      "parentUpdatedAt",
      "parentBodyHash",
      "claimHash",
      "commentStateHash",
      "ledgerWatermark",
      "originalPath",
      "currentPath",
      "originalLine",
      "currentLine",
      "severity",
      "resolutionHistory",
    ]);
    for (const key of ["targetId", "threadId", "fingerprint", "parentId"])
      text(target[key]);
    if (targetIds.has(String(target.targetId))) fail("duplicate_target");
    targetIds.add(String(target.targetId));
    for (const key of ["parentBodyHash", "claimHash", "commentStateHash"])
      hash(target[key]);
    for (const key of ["parentCreatedAt", "parentUpdatedAt"])
      timestamp(target[key]);
    decimal(target.ledgerWatermark);
    for (const key of ["originalPath", "currentPath"])
      if (target[key] !== null) path(target[key]);
    for (const key of ["originalLine", "currentLine"])
      if (target[key] !== null) integer(target[key], 1);
    if (
      typeof target.severity !== "string" ||
      !["critical", "major", "minor", "unknown"].includes(target.severity)
    )
      fail("severity");
    const history = row(target.resolutionHistory);
    exact(history, ["historyCut", "guardVersion", "state"]);
    text(history.historyCut);
    decimal(history.guardVersion);
    if (
      typeof history.state !== "string" ||
      ![
        "no_prior_since_creation",
        "before_cut_unobserved",
        "previously_resolved",
        "effect_unknown",
        "unavailable",
      ].includes(history.state)
    )
      fail("history");
  }
  if (!Array.isArray(plan.assignments) || plan.assignments.length > 2)
    fail("assignments");
  const assignedTargets = new Set<string>();
  const slots = new Set<string>();
  for (const value of plan.assignments) {
    const assignment = row(value);
    exact(assignment, [
      "workSlotId",
      "packetHash",
      "targetIds",
      "lifecycleTargetSetHash",
      "liveLifecycleStateHash",
    ]);
    text(assignment.workSlotId);
    const id = String(assignment.workSlotId);
    if (
      slots.has(id) ||
      !knownWorkSlotIds.includes(id) ||
      !fileAssignments.some((a) => a.workSlotId === id && a.paths.length === 0)
    )
      fail("slot");
    slots.add(id);
    for (const key of [
      "packetHash",
      "lifecycleTargetSetHash",
      "liveLifecycleStateHash",
    ])
      hash(assignment[key]);
    if (
      !Array.isArray(assignment.targetIds) ||
      assignment.targetIds.length < 1 ||
      assignment.targetIds.length > 4
    )
      fail("packet_targets");
    for (const targetId of assignment.targetIds) {
      if (
        typeof targetId !== "string" ||
        !targetIds.has(targetId) ||
        assignedTargets.has(targetId)
      )
        fail("target_assignment");
      assignedTargets.add(targetId);
    }
  }
  if (assignedTargets.size !== targetIds.size) fail("unassigned_target");
  // Copy all nested records; callers cannot change the admitted plan afterwards.
  return JSON.parse(JSON.stringify(plan)) as ReviewLifecycleAssignmentPlan;
}
function fail(reason: string): never {
  throw new Error(`review_lifecycle_assignment_${reason}_invalid`);
}
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("shape");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, names: readonly string[]) {
  if (
    Object.keys(value).length !== names.length ||
    names.some((name) => !Object.hasOwn(value, name))
  )
    fail("shape");
}
function text(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    value.includes("\0")
  )
    fail("text");
}
function hash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) fail("hash");
}
function decimal(value: unknown) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,19})$/.test(value))
    fail("decimal");
}
function integer(value: unknown, min = 0) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min)
    fail("integer");
}
function timestamp(value: unknown) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("timestamp");
}
function path(value: unknown) {
  text(value);
  if (
    value.length > 1024 ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("path");
}
