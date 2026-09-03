# Security scan record

**Date:** 2026-09-03 UTC

## Results

- Dependency audit: **0 critical**, **0 unresolved fast-uri/uuid/parser-glob
  high findings** after the workspace overrides; remaining high findings are
  the two advisories for `xlsx@0.18.5`, which has no published fixed version.
  The parser is reachable only after manager/admin authorization, the request
  is rate-limited and size-limited, the workbook signature is checked, and
  parsing is performed on the bounded workbook body.
- Static analysis: one high path-construction finding remains on the local
  storage reader. The code now accepts only generated UUID object identifiers,
  resolves beneath the configured storage root, rejects traversal, and opens
  the file with `O_NOFOLLOW`; traversal and invalid identifiers are covered by
  `tests/unit/source-storage.test.ts`. The scanner does not infer those
  guarantees through the helper.
- HoundDog dataflow scan: no findings.

## Follow-up risk

The `xlsx` package is currently required for controlled `.xlsx`/`.xls`
ingestion and has no upstream fix for the reported advisories. Before exposing
workbook upload to a lower-trust role or an internet-facing multi-tenant
deployment, replace it with a maintained parser or isolate parsing in a
separate process with strict CPU and memory limits. Keep the current
manager/admin authorization, 10 MB limit, signature check, and validation
pipeline in place until then.