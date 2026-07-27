# Contract change workflow

`openapi.yaml` is the source of truth for `/api/v1`. It is encoded as JSON, which is
valid YAML 1.2, so generation remains dependency-free and deterministic.

1. Make only backward-compatible additions to `openapi.yaml`. Breaking changes
   require a new API version.
2. Run `pnpm --filter @on-the-road/contracts generate`.
3. Review and commit both the specification and generated client.
4. Run `pnpm --filter @on-the-road/contracts generate:check` and the A04 tests.

`baseline/openapi.json` is the frozen v1 compatibility baseline. It must not be
rewritten to make a breaking check pass. A deliberate `/v2` introduction should add
a separate baseline and generation target.
