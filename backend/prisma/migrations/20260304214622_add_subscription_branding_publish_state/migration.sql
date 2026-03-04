ALTER TABLE "subscription_branding"
ADD COLUMN "isPublished" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "publishedAt" TIMESTAMP(3);

UPDATE "subscription_branding"
SET "isPublished" = true,
    "publishedAt" = COALESCE("updatedAt", "createdAt")
WHERE "enabled" = true;

CREATE INDEX "subscription_branding_scope_enabled_isPublished_priority_idx"
ON "subscription_branding"("scope", "enabled", "isPublished", "priority");
