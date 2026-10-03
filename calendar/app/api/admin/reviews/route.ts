import { requireAdmin } from "../../../admin-auth.ts";
import { createAdminApiHandlers } from "../../../admin-api.ts";
import { createCollectionRepository } from "../../../collection/repository.ts";
import { configuredReleaseSourceKeys } from "../../../collection/registry.ts";
import { collectSourceNow } from "../../../collection/run.ts";

const handlers = createAdminApiHandlers({
  requireAdmin,
  repository: createCollectionRepository(),
  configuredSourceKeys: configuredReleaseSourceKeys(),
  collectSource: collectSourceNow,
});

export const GET = handlers.GET;
