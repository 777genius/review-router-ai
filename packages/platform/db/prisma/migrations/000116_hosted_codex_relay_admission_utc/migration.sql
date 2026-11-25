-- Prisma timestamp-without-time-zone values represent UTC.
-- Keep atomic expiry/budget checks and the caller's timezone unchanged.
ALTER FUNCTION public.hosted_codex_relay_admission_guard() SET timezone = 'UTC';
