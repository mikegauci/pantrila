# Code-review follow-up — 19 October 2026

The fixes were shipped as focused pull requests, each checked locally and merged after CI.

| Finding | Resolution |
|---|---|
| DNS rebinding in recipe imports | [#24](https://github.com/mikegauci/pantrio/pull/24): direct connections to validated addresses, original HTTPS identity checks, validation on every redirect. The maintenance follow-up also adds failover among vetted addresses. |
| Concurrent requests bypass quotas | [#26](https://github.com/mikegauci/pantrio/pull/26): PostgreSQL reservations serialize allowance and shared-budget admission before paid work. |
| Cross-account cached data | [#25](https://github.com/mikegauci/pantrio/pull/25): a fresh cache/component subtree per user and user-scoped browser keys. |
| Drafts bypass the final safety guard | [#28](https://github.com/mikegauci/pantrio/pull/28): independent draft checks, structured warnings beside save actions, and explicit unchecked-ingredient warnings. |
| Old chat cards retain old allergy verdicts | [#27](https://github.com/mikegauci/pantrio/pull/27): cited cards refresh on load; #28 applies the same rule to written drafts. |
| Unmetered search embeddings | [#26](https://github.com/mikegauci/pantrio/pull/26): search quotas, budget reservations, usage events and a bounded embedding cache. |
| Failed plans lose partial usage | [#26](https://github.com/mikegauci/pantrio/pull/26): settlement retains partial calls/tokens, including embeddings and image postprocessing failures. |
| Allergen-name mentions pass safety evals | [#28](https://github.com/mikegauci/pantrio/pull/28): check structured rule warnings, with negative tests for unsafe reassurances. |
| Malformed plans trigger exponential fitting | [#27](https://github.com/mikegauci/pantrio/pull/27): invalid structures reach the checker without enumerating portions. |
| Slow imports occupy database connections | [#24](https://github.com/mikegauci/pantrio/pull/24) and [#26](https://github.com/mikegauci/pantrio/pull/26): absolute fetch deadlines, bounded DNS work, and connections borrowed only around repository operations. |

Further improvements include centralized kitchen-cache invalidation, upload and field bounds,
limited chat retention, optimistic conflict detection for concurrent chat turns, and an actual
unprivileged-role RLS test. An additional live gate exposed a fabricated citation; unknown IDs
are now replaced with an unverified-recipe marker and counted separately as blocked attempts.

The maintenance follow-up separates HTTP models, view construction and database backends from
routing. Insights is generated from explicitly selected committed reports; its consistency is
checked by pytest. Retrieval's existing capped-denominator metric is named **normalized recall**
in code, new reports, and the UI. Historical reports retain their original numbers and labels.

Browser regressions cover account switching, profile-warning refresh, the draft/edit/save flow
(including stale-preview removal), and interrupted plan streams. The latter now produce an
explicit error, while server-side keep-alives help connections survive long model calls.

Validation includes 228 offline/database tests, four production-browser tests, all eight paid
live gates, and a full 28-case assistant comparison. The API refactor preserves the OpenAPI
contract exactly across all 25 paths. Ruff, TypeScript and production builds pass.

The reservation migration has been applied to Supabase with RLS enabled. Reservations are
configurable estimates and do not impose a hard ceiling on the provider's eventual bill.
The latest assistant report is honest about remaining model-choice variability: 3/4 expected
draft/corpus decisions and 9/11 expected citations, with zero missing draft warnings and zero
unsafe or invented emitted citations. See [the selected report](../evals/reports/assistant-2026-10-19T132325Z.md).
