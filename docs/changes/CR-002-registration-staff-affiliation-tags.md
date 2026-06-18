---
id: CR-002
title: "Rename RBAC volunteer role to registration_staff and add user affiliation_tags"
status: done
date: 2026-06-18
requested_by: project owner (session 2026-06-18)
decided_by: project owner (session 2026-06-18)
layer: volatile
affects:
  - docs/prd/role-permission-matrix.md — RoleKey rename and permission matrix labels
  - docs/data/schema.md — _users metadata contract for affiliation_tags
  - docs/data/data-model.md — _users role examples and metadata rule
  - docs/data/api-contract.md — /api/v1/users payload and validation
  - docs/data/schema-er-diagram.md — user role/tag relationship notes
  - docs/task-breakdown/ — role references in baseline/core/people and Volunteer module clarification
  - docs/prd/phase-r2-foundation.md — role wording for registration duties
  - docs/prd/phase-r3-operations.md — Volunteer Coordinator responsibility clarification
  - docs/sitemap.md — role legend and route audience labels
  - docs/status/schema-v3-implementation-status.md — role example update
  - _users.roles[] migration: volunteer → registration_staff
---

# CR-002 — Rename RBAC volunteer role to registration_staff and add user affiliation_tags

## Why

The current `volunteer` RoleKey is overloaded: it means a staff permission role for intake and
registration work, while the same word also appears as a domain concept for volunteer profiles,
the Volunteer module, `/volunteers`, `volunteer:{ulid}`, skill matching, and future affiliation
labels. This makes the docs easy to misread and risks implementers treating volunteer identity as
an RBAC grant.

Rename the permission role to `registration_staff` so RBAC describes the job the account can do,
then add a separate metadata field for user affiliation tags such as `volunteer` or `governance`.

## Change

- Rename internal RBAC RoleKey `volunteer` → `registration_staff`.
- Rename the role matrix abbreviation `VOL` → `REG`.
- Move all permissions currently granted to `volunteer` to `registration_staff` unchanged.
- Add `_users.affiliation_tags: string[]` as user metadata.
- Define `affiliation_tags` as metadata only: it must not grant permissions, change shelter scope,
  bypass role checks, or enable write access by itself.
- Use `affiliation_tags` examples such as `volunteer` and `governance`; values should be unique
  lower_snake strings and default to `[]`.
- Keep the Volunteer domain unchanged: `volunteer:{ulid}`, Volunteer module, `/volunteers`, skill
  matching, shift assignment, and volunteer PII rules are not renamed.

## Impact

- `docs/prd/role-permission-matrix.md`: update role table, matrix column labels, scope rules,
  visibility notes, code impact mapping, and guardrail test wording.
- `docs/data/schema.md`: document the `_users` metadata contract for `affiliation_tags`.
- `docs/data/data-model.md`: update `_users.roles` examples and clarify role vs affiliation tag
  separation.
- `docs/data/api-contract.md`: update `/api/v1/users` request/response examples and validation
  for `affiliation_tags?`.
- `docs/data/schema-er-diagram.md`: update logical user relationship notes/examples.
- `docs/task-breakdown/01-core.md`, `_index.md`, `00-baseline.md`, and `02-people.md`: replace
  RBAC references from VOL/volunteer to REG/registration_staff.
- `docs/task-breakdown/06-A.md` and `07-B.md`: keep Volunteer module wording, but clarify that
  volunteer is a domain/profile concept and not a RoleKey.
- `docs/prd/phase-r2-foundation.md`: align Registration Officer/persona wording with
  `registration_staff`.
- `docs/prd/phase-r3-operations.md`: clarify Volunteer Coordinator as a responsibility owned by
  `shelter_manager`, not a separate RBAC role.
- `docs/sitemap.md`: update role legend and intake/backoffice audience labels.
- `docs/status/schema-v3-implementation-status.md`: update role examples.

## Migration

- Existing `_users.roles[]` values of `volunteer` must be migrated to `registration_staff`.
- Do not automatically infer `affiliation_tags: ["volunteer"]` from the old role. Add affiliation
  tags only from confirmed source data or explicit owner decision.
- No operational shelter document schema changes are required, so this CR does not bump
  `schema_v` for `shelter_{shelter_code}` docs.
- Any implementation migration should reject new `_users.roles[]` values of `volunteer` after the
  rename is approved and deployed.

## Approval checkpoint

This CR must be approved by the project owner before editing the affected specs. Until approval,
the only repository changes for this request should be this CR file and the CR index entry.

## Decision log

- 2026-06-18 — proposed by project owner request; tracking method confirmed as CR file.
- 2026-06-18 — approved and implemented by project owner instruction; all affected docs updated.
