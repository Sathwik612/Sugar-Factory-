---
name: OpenAPI codegen and Zod compatibility
description: Constraints discovered when generating API schemas in this workspace
---

The current generated validation package uses Zod 3, while the OpenAPI generator can emit Zod 4-only helpers for `integer` and browser-only globals for binary file schemas.

**Why:** Code generation can succeed while the chained library typecheck fails, which blocks every dependent package.

**How to apply:** Prefer portable numeric schemas for the initial contract and keep browser file-upload/storage steps behind dedicated adapters until the storage/auth path is configured. Run codegen and `pnpm run typecheck:libs` together after every spec change.