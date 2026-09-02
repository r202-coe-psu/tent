# 0001. Decoupled Registration, Medical Screening, and Zoning Flow

## Context & Decision

At shelter intake, having administrative staff perform both personal registration and clinical health evaluations created severe bottlenecks and posed zone allocation risks (e.g. allocating general bedding before discovering contagious conditions).

We decided to decouple intake into a 3-station modular pipeline (Registration Desk → Medical Screening Desk → Zoning & Wristband Desk) with per-shelter configurability (`shelter.feature_flags.enable_medical_screening`). Station 1 assigns `evacuee.current_stay.status = 'arriving'` and issues a Handover QR Slip (path-only deep link `/onsite/medical-screening/{evacuee_id}`). Station 2 (Medical Staff) records clinical screening and sets Triage Level (Green/Yellow/Red). Station 3 performs final zoning/check-in for high-volume centers.

**Station 2 UX (confirmed):** queue page at `/onsite/medical-screening` is search + QR/camera + table only (tabs: รอตรวจ / ตรวจแล้ว แก้ไขได้) with no side detail panel; the clinical form is a full-screen route `/onsite/medical-screening/[evacuee_id]` with sticky save footer, dirty-leave confirm, and re-edit prefill + banner. After save, always return to the queue with a toast that zoning handoff comes later — **no zone selection or check-in from Station 2 in this round** (deferred until Station 3 exists). Legacy `?evacuee_id=` query redirect on the queue page is not supported.

## Considered Options

- **Single monolithic intake with medical screening (Status Quo)**: Rejected because non-clinical volunteers cannot accurately triage, and long interviews create registration queues.
- **Mandatory 3 stations for all shelters**: Rejected because small shelters lacking healthcare personnel must be able to register and zone directly at a single desk.
- **Zoning before Medical Screening**: Rejected because assigning residential zones prior to infection or mobility screening leads to frequent emergency re-zoning.
- **Derived status instead of `arriving`**: Evaluated, but explicitly adding `arriving` to `evacuee.current_stay.status` (bumping schema_v to 9) ensures consistency with `household.status` and prevents occupancy counts from treating unassigned evacuees as active bed occupants.
- **Master-detail Station 2 (queue + inline form)**: Rejected for tablet/mobile density; replaced by queue → full-page form navigation.
- **Inline zoning/check-in from Station 2 this round**: Deferred; keep API optional `zone`/`checkIn` for later, but UI saves screening only and returns to queue.

## Consequences

- Evacuee schema version bumps from 8 to 9 to include `'arriving'` in `current_stay.status`.
- Core form sub-components under `$lib/features/people/ui/forms/` are consolidated and shared between registration, edit profile modals, and the medical screening form page.
- Role-based route guard restricts `/onsite/medical-screening` (and `/[evacuee_id]`) to `medical_staff`, `triage_staff`, `shelter_manager`, and `system_admin`.
- Station 2 queues are reactively derived: **รอตรวจ** (`status: 'arriving'|'pre_registered'`, no screening doc) and **ตรวจแล้ว** (has screening doc; re-editable). Pending Zoning for Station 3 remains a later concern (`status: 'arriving'`, has screening, `zone: null`).
