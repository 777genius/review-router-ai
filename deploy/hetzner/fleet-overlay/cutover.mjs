/** Pure cutover sequencing; callbacks own Docker I/O and durable phase receipts. */
export const stopOrder = ["worker", "api", "web", "scan"];
export const startOrder = ["scan", "api", "web", "worker"];
export function requireNoExtraScopedWorkers(
  running,
  knownIds,
  previousImage,
  targetImage,
) {
  for (const c of running) {
    const networks = c.NetworkSettings?.Networks ?? {};
    const labels = c.Config?.Labels ?? c.Labels ?? {};
    const scoped =
      Object.hasOwn(networks, "platform-review-router") &&
      (c.Image === previousImage ||
        c.Image === targetImage ||
        labels["org.opencontainers.image.source"] ===
          "https://github.com/777genius/review-router-ai");
    if (scoped && !knownIds.includes(c.Id))
      throw Error("extra_scoped_running_replica");
  }
}
export async function coherentCutover(io) {
  await io.verifyAllCandidatesStopped();
  await io.verifyAllBaselines();
  await io.verifyScopedInventory();
  await io.persistCanonical();
  for (const role of stopOrder) {
    await io.stopAndRetain(role);
  }
  await io.verifyAllOldStopped();
  await io.verifyScopedInventory();
  for (const role of startOrder) {
    await io.verifyAllOldStopped();
    await io.verifyScopedInventory();
    await io.startAndVerify(role);
  }
}
