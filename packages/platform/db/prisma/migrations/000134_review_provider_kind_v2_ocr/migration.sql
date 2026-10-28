-- Additive only: existing rows keep their provider kinds unchanged. OCR
-- observations/lanes may now persist through ReviewProviderKindV2.
ALTER TYPE "ReviewProviderKindV2" ADD VALUE IF NOT EXISTS 'ocr';
