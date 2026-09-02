---
name: OpenAPI codegen and Zod compatibility
description: Constraints discovered when generating API schemas in this workspace
---

The current generated validation package uses Zod 3, while the OpenAPI generator can emit Zod 4-only helpers for `integer`, browser-only globals for binary file schemas, and duplicate exports for inline request bodies/query parameters.

**Why:** Code generation can succeed while the chained library typecheck fails, which blocks every dependent package.

**How to apply:** Prefer portable numeric schemas and named component schemas for request bodies; avoid combining inline query parameter types with generated Zod endpoint exports. Keep browser file-upload/storage steps behind dedicated adapters until configured. Run codegen and `pnpm run typecheck:libs` together after every spec change.