-- Verified-fix replies are independent append-only publication operations.
-- The existing thread_lifecycle kind and guarded resolution policy remain unchanged.
ALTER TYPE "ReviewPublicationKindV2" ADD VALUE IF NOT EXISTS 'thread_reply';
