# 0001. Decoupled Registration, Medical Screening, and Zoning Flow

- Status: accepted
- Date: 2026-09-02
- Updated: 2026-09-03
- Supersedes: monolithic registration+EWAR+zone at a single desk

## Context & Decision

At shelter intake, combining personal registration, clinical evaluation, and zone assignment at one desk created bottlenecks and unsafe early zone allocation.

**Decision:** Decouple intake into a modular 3-station pipeline with per-shelter toggle `shelter.feature_flags.enable_medical_screening`:

| Flag | Pipeline |
| --- | --- |
| ON | Station 1 (Registration) → Station 2 (Medical Screening) → Station 3 (Zoning) |
| OFF | Station 1 → Station 3 (skip medical) |

The flag **only** toggles Station 2 visibility and whether a Handover Slip is issued after registration. **Zoning / check-in never happens at Station 1.**

### Station 1 — Registration Desk (`/onsite/people`)
- Primary UI: single table (all stay statuses) + search + filter chips + Person QR scan; column 「คิวถัดไป」 (`รอแพทย์` / `รอโซน` / `พักแล้ว`)
- New registration: `/onsite/people/new` — personal + special_needs → household → pets/assets/vehicles → done
- Persist via `createEvacuee` only (`status: arriving`, `zone: null`); **no** EWAR step, **no** screening doc, **no** zone step
- End of `/new`: always Person QR; if flag on also Handover Slip (`/onsite/medical-screening/{id}`)
- `pre_registered` check-in interview promotes to `arriving` then CTAs to S2 or S3

### Station 2 — Medical Screening (`/onsite/medical-screening`)
- Queue (tabs รอตรวจ / ตรวจแล้ว) + full-page form `/[evacuee_id]`
- After save: clear buttons 「ไปจัดโซนเลย」→ `/onsite/zoning/[id]` and 「กลับคิวแพทย์」 — no zone selection on this station

### Station 3 — Zoning (`/onsite/zoning`)
- Roles: registration_staff, facility_staff, shelter_manager, system_admin (`canAccessZoning` / `requireZoning`)
- Pending: flag on = arriving + has screening + zone null; flag off = arriving + zone null
- First assign: atomic `check_in` → toast + back to queue (no Person QR ceremony)
- Rezone: movement action `zone_change` (keeps status, updates zone); migrate profile/household zone moves onto this path
- Household: person-primary; optional pending-queue household members; isolation default when quarantine recommended; never sever `household_id`

## Considered Options

- **Single monolithic intake:** Rejected — long interviews; non-clinical staff cannot triage safely.
- **Mandatory 3 stations always:** Rejected — small shelters lack medical staff.
- **Zoning before medical:** Rejected — unsafe early bedding assignment.
- **Zoning at Station 1 when flag off (unified desk):** Rejected (2026-09-03) — still couples registration with placement; Station 3 remains the only zoning desk.
- **Derived status instead of `arriving`:** Rejected — explicit status keeps occupancy and queues consistent.
- **Inline zoning from Station 2:** Deferred / rejected for UI — Station 3 owns placement.

## Consequences

- `evacuee` schema_v 9 adds `arriving`; `screening` schema_v 2 adds `triage_level`; shelter flags add `enable_medical_screening`
- `movement.action` gains additive `zone_change` (no movement schema_v bump)
- Shared form cores under `$lib/features/people/ui/forms/`
- Route guards: Station 2 medical roles; Station 3 REG+FAC+SM+SA
- Station 1 no longer calls `createEvacueeWithScreening` for the happy path (keeps S2 pending queue meaningful)
