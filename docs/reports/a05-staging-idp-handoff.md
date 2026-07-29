# A05 Staging IdP handoff

- Status: **BLOCKED**
- Date: 2026-07-29
- Scope: Staging IdP Track only
- Dev Track impact: none once `TC-A05-01`, `TC-A05-02`, and `TC-A05-03` pass
- Release impact: blocking

## Missing external inputs

- `OTR_OIDC_ISSUER`
- `OTR_OIDC_CLIENT_ID`
- `OTR_OIDC_CLIENT_SECRET` from the approved external Secret store
- `OTR_OIDC_CALLBACK_URL` registered as an exact HTTPS URI
- `OTR_OIDC_POST_LOGOUT_REDIRECT_URL` registered as an exact HTTPS URI

No real callback, provider logout, provider outage, external Secret rotation
or HTTPS Cookie observation was attempted because these inputs and a reachable
Staging IdP are absent. Mock OIDC evidence must not be presented as evidence
for any of those checks.

## Release handoff

1. Choose the production provider and record its issuer in
   `docs/adr/identity.md`.
2. Create a dedicated staging client and register exact callback, application
   Origin, and post-logout redirect URIs.
3. Supply credentials through the external Secret store.
4. Replace the offline readiness guard in
   `tests/identity/oidc-release.e2e.spec.ts` with the provider-specific,
   approved interactive smoke adapter.
5. Run the full A05 section of `docs/runbooks/release-checklist.md`, attach
   redacted output and obtain the release approver's sign-off.

Until all five steps and every A05 release checklist item pass, formal release
is not allowed.
