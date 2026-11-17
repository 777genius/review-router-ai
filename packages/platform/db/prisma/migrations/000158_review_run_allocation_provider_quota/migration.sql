-- Plan 69: the review-run relay records a provider quota exhaustion it observed
-- itself for one Gateway allocation. Finalization may excuse that reviewer's
-- terminal required slots while another reviewer completed all of its own.
-- Additive nullable column; the 000152 guard keeps identity columns immutable.
BEGIN;
ALTER TABLE "ReviewRunGatewayAllocationExecution"
  ADD COLUMN "providerQuotaExhaustedAt" TIMESTAMP(3);
COMMIT;
