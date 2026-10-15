-- Immutable approved toolchain roster; NULL retains legacy producer semantics.
ALTER TABLE "ProducerRelease" ADD COLUMN "agentProfilesJson" TEXT;
