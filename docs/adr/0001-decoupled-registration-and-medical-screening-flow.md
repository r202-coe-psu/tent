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
- Primary UI: single table (all stay statuses) + search + filter chips + Person QR scan; column 「คิวถัดไป」 (`รอแพทย์` / `รอโซน` / `พักแล้ว`); household column UI label 「ครอบครัว」
- **Shared registration shell** (single-page form + scroll spy — **not** a multi-step wizard): walk-in `/onsite/people/new` **and** Report-in `/onsite/people/[id]/report-in`
  - Sections: photo (**optional**) → personal identity → household (UI 「ครอบครัว」) → emergency contact (**required**) → special needs (no “กลุ่มเปราะบาง” copy) → pets/assets/vehicles (section E, last when visible)
  - Sticky section chips (top) + sticky save (bottom); dirty leave confirm; **no autosave**
  - Full-page validate on save → error summary + jump to first invalid section
  - Section E: one nav chip when any of `allow_pets|allow_assets|allow_vehicles`; hide when all false; if existing data while flags off → show **entire** section **read-only**; when flags allow and household is linked/selected → **fetch fill-in** pets/assets/vehicles and allow edit (writes through to shared Household on save)
  - **Household UX (supersedes keep/create/join/solo chips):** default = Residence form for **new** Household (`label` auto `ครอบครัว{name}`); debounced Residence match **suggests** existing Households (never blocks create); separate 「เข้าร่วม」 searches shelter Evacuees with `household_id` by **name/phone** (any stay status). Linked mode: summary + keep default / change Residence / leave+create / join other. **Residence** required on create (min: house no + province/district/subdistrict); lives on Household only. **Identity-document address** stays on Evacuee; smart-card may **prefill** Residence as editable suggestion. Domain term remains **Household** (`CONTEXT.md`); Thai UI = ครอบครัว
  - Leaving household allowed; if subject is household head and that household still has other members → **must pick new head from current members of that household only** before leave (atomic in interview submit); if subject is the **last member**, **auto-cancel/dissolve** the vacated household after leave
- 「ลงทะเบียนใหม่」→ `/new`; `pre_registered` 「รายงานตัว」→ `/[id]/report-in` (full form — **not** one-click status patch)
- Persist: walk-in via `createEvacuee` only (`status: arriving`, `zone: null`); Report-in updates + promotes `pre_registered` → `arriving` (`zone` stays null). **No** EWAR step, **no** screening doc, **no** zone step at Station 1
- End of either form: **must issue Person QR**; if flag on also Handover Slip (`/onsite/medical-screening/{id}`); back to queue / CTA S2 or S3

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
- **Multi-step Station 1 wizard:** Superseded (2026-09-03) — collapsed to single-page + scroll spy for speed and pre_registered review on mixed tablet/laptop; shared shell for walk-in and Report-in.
- **One-click 「รายงานตัว」 status patch:** Rejected (2026-09-03) — Report-in must open the full interview form.
- **Station 1 household chips keep/create/join/solo + nested search/create form:** Superseded (2026-09-03) — default Residence form + debounced address suggestions + 「เข้าร่วม」 by Evacuee name/phone; UI label ครอบครัว; create≈solo collapsed.
- **Store identity-document address on Household:** Rejected (2026-09-03) — belongs to Evacuee; Household holds **Residence** only.
- **Block create when Residence matches existing Household:** Rejected (2026-09-03) — same address ≠ same unit; suggestions only.

## Consequences

- `evacuee` schema_v 9 adds `arriving`; `screening` schema_v 2 adds `triage_level`; shelter flags add `enable_medical_screening`
- `movement.action` gains additive `zone_change` (no movement schema_v bump)
- Shared form cores under `$lib/features/people/ui/forms/`; Station 1 composes them into one scroll-spy page (walk-in + Report-in)
- Route: Report-in at `/onsite/people/[id]/report-in`
- Route guards: Station 2 medical roles; Station 3 REG+FAC+SM+SA
- Station 1 no longer calls `createEvacueeWithScreening` for the happy path (keeps S2 pending queue meaningful)
- Glossary: **Report-in**, **Residence**, **Identity-document address**; **Household** remains canonical (Thai UI ครอบครัว) in `CONTEXT.md`
- Station 1 create validates minimum Residence on Household; no household schema_v bump for this UX rewrite

---

### Changelog

- 2026-09-02 — Accepted: 3-station pipeline + medical flag + `arriving`
- 2026-09-03 — Clarified: flag never enables zoning at Station 1; Station 3 owns placement
- 2026-09-03 — Station 1 UX: wizard → single-page + scroll spy; Report-in route; shared shell with `/new`; head-transfer-on-leave; no one-click patch (aligned with CR-106 in-place update)
- 2026-09-03 — Ambiguity lock-in: photo optional; household keep/join explicit (smart-card existing household); section E read-only = whole section; post-submit primary ceremony = Person QR; new head = current household members only; last member leave → auto-dissolve prior household
- 2026-09-03 — Section order: photo → identity → household → required emergency contact → special needs → section E last when visible
- 2026-09-03 — Household UX rewrite: supersede keep/create/join/solo; default Residence form + debounced suggest + join-by-evacuee; UI ครอบครัว; Residence vs identity-document address; section E fetch+edit write-through; leave/head rules unchanged (CR-106)
