# Smart Shelter Domain Context

Canonical glossary and domain model vocabulary for the Smart Shelter disaster evacuation management system.
Project acronyms (FR, MD, R2…) and technical/architecture terms live in
[`docs/task-breakdown/glossary.md`](docs/task-breakdown/glossary.md); this file is the source of truth for domain terms.

<!-- decision sync 2026-11-10 (#1161, PR #1279): ชี้แจงป้าย homeless โดยคง code และความหมายเดิม -->
<!-- decision sync 2026-11-27 (glossary cleanup): CONTEXT.md = ศัพท์โดเมนหลัก, glossary.md = ตัวย่อ/ศัพท์เทคนิค · คำไทย Evacuee = ผู้พักพิง · Household = ครอบครัว, คนแรก = ผู้ติดต่อหลัก · ตาราง Stay Status + ป้ายไทย · Station (UI ใช้ชื่อจุด ไม่แสดงเลข) · เพิ่ม Shelter / Shelter Code / Site Kind / Shelter Type / Zone / Movement / Person QR / Staff User / Personnel / Staff·Public plane / Projection / External API Key · นิยามใหม่ Arriving, Triage Level, Zoning, Handover Slip · Forecast Occupancy เพิ่ม kiosk_registered + เพิ่ม In-shelter Occupancy ให้ตรง schema.md §1.1 -->

## People & Intake

**Evacuee**:
A displaced person seeking shelter, care, and basic necessities inside an evacuation shelter.
_UI (th)_: ผู้พักพิง.
_Avoid_: Refugee, patient, client, customer, Person (PRD/UI shorthand only — not a persisted entity); (th) ผู้ประสบภัย, ผู้อพยพ, ผู้ลี้ภัย.

**Anonymous ID**:
A system-issued identity handle for an Evacuee who has no national ID or passport, stored as `person_id.cardType = anonymous` with a unique `number`, usable for search and on-site tracking.
_Avoid_: Guest ID, temporary ID, other (generic cardType), null identity with no handle.

**Household**:
A grouping of one or more Evacuees who arrive and are managed together, with a designated Primary Contact (`head_evacuee_id`). It is not the primary carrier of stay/occupancy state — stay truth lives on each Evacuee (and Movements). `household.status` (`pre_registered` | `arriving` | `checked_in` | `checked_out` | `cancelled` | `merged`) is a coarse compatibility value derived from member stays (`merged` is set only by the household-merge flow); it is not a parallel lifecycle to track.
_UI (th)_: ครอบครัว; the `head_evacuee_id` member is ผู้ติดต่อหลัก (Primary Contact) everywhere in the UI.
_Avoid_: Family, group, tent party, household as the source of stay truth; (th) ครัวเรือน, หัวหน้าครัวเรือน, หัวหน้าครอบครัว.

**Residence**:
The shared dwelling address of a Household (where the unit lives while displaced or at home of record for the unit). May omit house number; may record only an approximate origin (landmark, road, subdistrict) when the unit is homeless or has no formal address.
_Avoid_: Domicile (ambiguous), home address, mailing address.

**Housing Type**:
A master-data classification of the Household's Residence kind: owned home, rented, condo, apartment/dorm, or no fixed residence (no house number or fixed address — not a separate code).
_Avoid_: House damage, shelter type, zone, no_house_number (folded into homeless).

**Identity-document address**:
The address printed on an Evacuee's identity document; it belongs to that person, not to the Household.
_Avoid_: Card address on Household, registered address (ambiguous with Residence).

**Registration**:
The initial administrative intake process that captures an evacuee's identity, household grouping, emergency contact, vulnerable-group flags, and free-form special needs.
_Avoid_: Check-in, triage, admission.

**Station**:
An on-site service desk in the shelter. Stations 1–3 form the intake pipeline ([ADR-0001](docs/adr/0001-decoupled-registration-and-medical-screening-flow.md)); Station 4 sits outside it.

| Station | UI (th) | Work | Route |
| --- | --- | --- | --- |
| 1 | จุดลงทะเบียน | Registration — walk-in create or Report-in; leaves stay `arriving`, `zone: null` | `/onsite/people` |
| 2 | จุดคัดกรองสุขภาพ | Medical Screening (EWAR + Triage Level); optional (shelter flag `enable_medical_screening`), never changes stay status | `/onsite/medical-screening` |
| 3 | จุดจัดโซน | Zoning + Check-in → `active` | `/onsite/zoning` |
| 4 | จุดแจกจ่าย | Distribution of goods and meals (CR-159) | `/onsite/distribution` |

The UI shows the desk name only, never the number. Docs and code keep "Station N".
_Avoid_: (th) สถานี N in UI copy, โต๊ะ…; implying Station 2 is a mandatory step.

**Report-in**:
The Station 1 interview that confirms or edits Registration data for an evacuee whose stay status is `pre_registered` (or `kiosk_registered`), then promotes that stay to `arriving`.
_Avoid_: Check-in, Registration (the broader intake process that also includes walk-in create), one-click status patch.

**Public Pre-registration**:
A self-service online intake flow that captures basic household and person identities before arrival. Two paths: (1) book a known shelter → Couch `pre_registered` hold; (2) Unassigned Registration when shelter is not yet chosen → Mongo `unassigned_registrations` until a shelter claims members into Evacuees.
_Avoid_: Online check-in, public registration (ambiguous with staff Station 1 walk-in), pre-admission, Central Pool (retired term).

**Medical Screening**:
A clinical evaluation conducted by healthcare personnel at Station 2 to assess surveillance symptoms (EWAR), vital signs, Triage Level, and ongoing medical conditions.
_Avoid_: Diagnosis, general checkup, registration.

**Chronic Disease**:
A specific long-term disease recorded on an Evacuee's medical record (`medical.conditions`), chosen from the central standard list or entered as free text when not listed. Records _which_ disease; it does not by itself mark the Evacuee as vulnerable.
_Avoid_: Chronic illness (that is the Vulnerable Group flag), health condition, underlying condition.

**Allergy**:
A substance an Evacuee is allergic to, recorded on the medical record (`medical.allergies`), chosen from the central standard list (food allergens) or entered as free text when not listed (e.g. a drug).
_Avoid_: Dietary restriction (a preference, not a medical record), intolerance.

**Triage Level**:
A 3-color clinical classification (Green, Yellow, Red) chosen by staff at Station 2 (default Green). It is a zone **recommendation** only: Yellow or Red, or any EWAR symptom, recommends a `quarantine` zone; Station 3 makes the actual zone decision ([CR-258](docs/changes/00-baseline/CR-258-station2-triage-reinstate.md)).
_Avoid_: Priority code, track, severity score; treating the color as an automatic zone assignment.

**Vulnerable Group**:
A master-data multi-select classification on the Evacuee (`vulnerable_groups[]`) for reporting, zoning hints, and care prioritization. Canonical seed codes include bedridden, dialysis, wheelchair, psychiatric, elderly_dependent, infant, young_child, pregnant, vision_impaired, hearing_impaired, disability_other, chronic_illness (`infant` and `young_child` are distinct; `disability_other` is the non-specific disability bucket beside vision/hearing/wheelchair/bedridden). `chronic_illness` is a care-priority flag set by staff judgement, independent of any recorded Chronic Disease.
_Avoid_: Special Needs, handicaps, legacy codes `elderly`/`disabled` (migrate to `elderly_dependent`/`disability_other`).

**Special Needs**:
Free-form requests for accommodations or support an Evacuee wants (what they ask for), not a coded vulnerability taxonomy.
_Avoid_: Vulnerable Group, disability flags, structured diagnosis codes.

**Pet**:
An animal accompanying a Household, recorded on the household as `pets[]` with species `dog|cat|other` (free-text `notes` required when `other`) and optional `image_url`.
_Avoid_: Livestock catalog, standalone pet documents, hardcoding `bird`/`monkey` as species enums.

**Person QR**:
The scannable identity of one Evacuee, payload `evacuee:{ULID}@{hash6}`. A new QR is issued on every print and the previous one expires ([CR-233](docs/changes/02-people/CR-233-evacuee-qr-rotate-on-print.md)). Printed on the Handover Slip, the QR ID card, and the kiosk label ([CR-150](docs/changes/14-kiosk/CR-150-kiosk-label-stacked-qr-name-tag.md)).
_Avoid_: Household QR (removed by CR-051), ticket, token.

**Handover Slip**:
The printed slip issued at Station 1 that carries the Evacuee's Person QR so the next desks (Station 2, Station 3) can open that person by scanning it.
_UI (th)_: ใบส่งตัว.
_Avoid_: Ticket, coupon, receipt; using "Handover Slip" for the QR itself.

## Shelter & Site

**Shelter**:
Any site that takes in Evacuees, whatever its Site Kind. Each has a Shelter Code and its own CouchDB database.
_UI (th)_: ศูนย์พักพิง (the umbrella term).
_Avoid_: Camp; (th) ศูนย์อพยพ as the umbrella term (it names one Site Kind), จุดพักพิง.

**Shelter Code**:
The permanent code of a Shelter. Names its database (`shelter_{code}`) and scopes staff roles (`{code}:{capability}`, see Compound Scoped Role).
_Avoid_: Shelter id, location code (that is the partner-facing Location Master code).

**Site Kind**:
A global master-data classification of what role a Shelter plays (`shelter.site_kind`): `evacuation_center` = ศูนย์อพยพ (default), `host_house` = บ้านพี่เลี้ยง, `test_center` = ศูนย์ทดสอบ.
_Avoid_: Shelter Type (that is the building), site type.

**Shelter Type**:
A master-data classification of the building a Shelter occupies (`shelter.shelter_type`, e.g. school, temple). Says nothing about the Shelter's role.
_UI (th)_: ประเภทอาคาร.
_Avoid_: Site Kind.

**Zone**:
The only allocation unit inside a Shelter (`shelter.zones[]`): a `code`, `capacity`, `type` (`general` | `male` | `female` | `vulnerable` | `pet` | `quarantine`) and `status` (`active` | `closed`).
_UI (th)_: โซน.
_Avoid_: Room, tent, bed — the system has no such entities.

## Accommodation & Movement

**Zoning**:
The allocation of an Evacuee or Household to a Zone within the Shelter (Station 3).
_Avoid_: Bed booking, seating, housing; room or tent allocation.

**Check-in**:
The formal entry action and Movement that assigns a Zone and transitions stay to `active`.
_Avoid_: Registration, arrival, Zone Arrival Confirmation.

**Movement**:
The append-only record of every change to an Evacuee's stay; it is the source of truth for stay (`current_stay` is a snapshot). Actions: `check_in`, `check_out`, `transfer_out` / `transfer_in`, `leave_temporary` / `return_from_leave`, `mark_deceased`, `zone_change`, `confirm_room`, `revert_status` (SM/SA only, reason required — [CR-262](docs/changes/02-people/CR-262-evacuee-status-revert.md)).
_Avoid_: Status patch, editing `current_stay` directly.

**Stay Status**:
The lifecycle of one Evacuee's stay at one Shelter (`evacuee.current_stay.status`). Occupancy columns follow `docs/data/schema.md` §1.1.

| Code | UI (th) | Meaning | Forecast | Present | In-shelter | In-zone |
| --- | --- | --- | :-: | :-: | :-: | :-: |
| `pre_registered` | ลงทะเบียนล่วงหน้า | Booked or rostered for this Shelter; not yet reported in | ✓ | | | |
| `kiosk_registered` | ลงทะเบียนที่ตู้ (รอยืนยัน) | Self-registered at a kiosk; awaits Report-in at Station 1 | ✓ | | | |
| `arriving` | รายงานตัวแล้ว · รอจัดโซน | Through Station 1 and on site, no Zone yet (see note) | ✓ | | | |
| `active` | เข้าพักแล้ว | Checked in with a Zone assigned | ✓ | ✓ | ✓ | |
| `room_confirmed` | ยืนยันถึงโซนแล้ว | Zone Arrival Confirmation done | ✓ | ✓ | ✓ | ✓ |
| `temporary_leave` | ออกชั่วคราว | Out of the Shelter, return expected | ✓ | ✓ | | |
| `transferred` | ย้ายศูนย์ | Moved to another Shelter | | | | |
| `checked_out` | เช็คเอาต์ | Left the Shelter | | | | |
| `deceased` | เสียชีวิต | Died | | | | |
| `cancelled` | ยกเลิกการลงทะเบียนล่วงหน้า | Pre-registration cancelled before arrival | | | | |

- **`arriving`**: set by Station 1 (walk-in or Report-in) with `zone: null`. If the Shelter enables medical screening the person may pass Station 2 first, but Station 2 is not required and does not change status; only Check-in at Station 3 moves the stay out of `arriving`. _Avoid_: Pending, queued, unregistered, ARRIVED_TRIAGE (stakeholder label only); (th) กำลังเดินทางมา.
- **`active`**: _Avoid_: Checked-in, resident, admitted, "at bed" (that is `room_confirmed`); (th) อยู่ในศูนย์, เช็คอิน.
- **`checked_out`**: _Avoid_ (th): ย้ายออก (confuses with `transferred`).

**Backfill Import**:
The people-import file used to bring in evacuees who have actually stayed (still housed or already left) with their real check-in/check-out times — e.g. an LAO or caretaker-home shelter that opened before the system. Each row carries a stay status (`active` / `checked_out`), arrival time, departure time and zone, and writes back-dated `check_in` / `check_out` movements (the check-out reason is `backfill_import`).
A row whose stay status is blank (#1448) carries no stay: that person is imported `pre_registered` with no movement and waits in the Station 1 Report-in queue (decided per person, so a household may mix statuses); a blank status with a time or zone filled in is a validation error.
_Avoid_: Advance booking (a booking comes from public booking / the registration page, not a stay that happened — a blank-status row is only a roster entry awaiting Report-in).

**Zone Arrival Confirmation**:
The explicit confirmation that an Evacuee has physically reached their assigned Zone after check-in; persisted as stay status `room_confirmed` (after `active`).
_Avoid_: Check-in, Active, bed scan (implementation detail), RE_ENTERED.

**Unassigned Registration**:
A household-level pre-arrival intake recorded before any shelter is chosen. Persisted only in Mongo (`unassigned_registrations`); members are not Evacuees until a shelter claims them into Couch. Staff search this collection directly (no `public_persons` stub until claim). Partial claim leaves unclaimed members `open` for later intake. Does not count toward shelter Forecast occupancy until claimed.
_UI (th)_: ลงทะเบียนล่วงหน้าแบบไม่ระบุศูนย์.
_Avoid_: Central Pool, `central_pool_registration`, equating with Couch `pre_registered` holds for a known shelter, treating Mongo as SoR for checked-in Evacuees.
_Spec_: [CR-113](docs/changes/00-baseline/CR-113-unassigned-registration-mongo.md) (approved).

**Forecast Occupancy**:
Headcount of evacuees expected at the shelter for capacity planning: stay ∈ {`pre_registered`, `kiosk_registered`, `arriving`, `active`, `room_confirmed`, `temporary_leave`} on that shelter's Couch SoR. In-shelter public booking holds remain Couch `pre_registered`. Unassigned Registration Mongo documents are excluded until claimed. Excludes `transferred`, `checked_out`, `deceased`, `cancelled`. Spec: [CR-112](docs/changes/00-baseline/CR-112-registration-foundation-schema-stay.md) (approved).
_Avoid_: Single blended occupancy number, only-active count.

**Present Occupancy** (actual):
Headcount confirming the person is still on the shelter's books as present: stay ∈ {`active`, `room_confirmed`, `temporary_leave`}. `temporary_leave` remains Present because return is expected. Distinct from Forecast Occupancy and from In-zone Occupancy.
_Avoid_: Mixing forecast holds into “how many are here now” without labeling.

**In-shelter Occupancy**:
Headcount of people physically in the shelter: stay ∈ {`active`, `room_confirmed`}. The shared number for capacity, stock, kitchen, SOP, `daily_calc.occupancy_snapshot`, and partner `occupancy_total` ([CR-224](docs/changes/01-core/CR-224-in-shelter-headcount.md)).
_Avoid_: Present (which also counts `temporary_leave`), only-active count.

**In-zone Occupancy**:
Headcount of Evacuees with stay `room_confirmed` only (physically confirmed at assigned zone/bed). Dropped while on `temporary_leave`.
_Avoid_: Equating In-zone with Present.

**Shelter Incident Log** (บันทึกเหตุการณ์ประจำวัน):
The shelter's daily occurrence book: a record of safety, conduct, and grievance events inside the shelter, each with a responsible owner and an append-only history of actions and reasons. Kept by security officers and shelter managers (and system admins); the complainant and the respondent are recorded separately, and an unknown respondent may be identified once, later. Records are never deleted — a false or duplicate report is cancelled.
_Avoid_: Shelter report, Shelter Report `kind: grievance | incident` (retired with CR-040, replaced by CR-155), grievance ticket, security event, police report.

## Staff & Personnel

**Staff User**:
A person with a login (`_users` account) whose access comes from roles — `system_admin`, or Compound Scoped Roles such as `{code}:shelter_manager`, `{code}:registration_staff`, `{code}:medical_staff` (list: `frontend/src/lib/auth/roles.ts`).
_UI (th)_: ผู้ใช้งานระบบ.
_Avoid_: Staff (ambiguous), Personnel.

**Personnel**:
A row in a Shelter's workforce register (the `volunteer` doc), typed by `personnel_type`: `volunteer` = อาสาสมัคร, `staff` = เจ้าหน้าที่ประจำศูนย์. `personnel_type` grants no permission and the person may have no login ([CR-097](docs/changes/06-A-volunteer/CR-097-volunteer-job-shifts-personnel-type.md)).
_UI (th)_: กำลังพล.
_Avoid_: Staff User; reading `personnel_type = staff` as a system role.

## Interoperability & External Exchange

**Staff plane / Public plane**:
The two data planes. Staff plane: logged-in UI ↔ CouchDB (the system of record). Public plane: anonymous pages ↔ SvelteKit BFF ↔ FastAPI ↔ Mongo `public_*` (read-only).
_Avoid_: Calling Mongo the source of truth; browser → FastAPI calls without the BFF.

**Projection**:
A read-only Mongo `public_*` document the sync worker builds from CouchDB for the Public plane and partner API. Never the system of record; its shape is versioned by `PROJECTION_VERSION`.
_Avoid_: Replica, cache, copy (implies writable or SoR).

**Compound Scoped Role**:
A staff capability bound to one shelter in `_users.roles` as `{shelter_code}:{capability}` (with a matching `shelter:{code}` access gate), so one account may hold different duties in different shelters without privilege bleed.
_Avoid_: Global staff role, flat multi-shelter role list.

**Location Master**:
The authoritative register of shelter facilities published to partner systems with permanent, non-reusable location codes.
_Avoid_: Shelter directory, site list, place catalog.

**Partner Module**:
An external disaster management subsystem (e.g. M6 Resource Logistics, M7 Command Center) integrating with Smart Shelter via scoped tokens.
_Avoid_: Third-party app, consumer, external client.

**External API Key**:
The managed `X-API-Key` a Partner Module sends to `/external/v1/*`. Distinct from `EXTERNAL_API_SECRET`, the internal Bearer the SvelteKit BFF uses to call FastAPI.
_Avoid_: Using the two secrets interchangeably.

**Administrative Code**:
The official Department of Provincial Administration (DOPA) hierarchical numerical codes for provinces (2 digits), districts (4 digits), and subdistricts (6 digits).
_Avoid_: Postal code, location text, geo string.
