/** The composition root supplies the existing database lease implementation. */
export interface OrgRulesetProvisioningLockPort {
  withLease<T>(
    key: string,
    ttlMs: number,
    run: (lease: { assertHeld(): Promise<void> }) => Promise<T>,
  ): Promise<T>;
}
