# Smart Shelter Domain Context

Canonical glossary and domain model vocabulary for the Smart Shelter disaster evacuation management system.

## People & Intake

**Evacuee**:
A displaced person seeking shelter, care, and basic necessities inside an evacuation shelter.
_Avoid_: Refugee, patient, client, customer, Person (PRD/UI shorthand only — not a persisted entity).

**Anonymous ID**:
A system-issued identity handle for an Evacuee who has no national ID or passport, stored as `person_id.cardType = anonymous` with a unique `number`, usable for search and on-site tracking.
_Avoid_: Guest ID, temporary ID, other (generic cardType), null identity with no handle.

**Household**:
A grouping of one or more Evacuees who arrive and are managed together, with a designated head. It is not the primary carrier of stay/occupancy state — stay truth lives on each Evacuee (and movements). Existing `household.status` may be retained only as a coarse derived/compatibility field, not as a parallel lifecycle to track.
_Avoid_: Family, group, tent party, household as the source of stay truth.
_UI (th)_: ครอบครัว — display label only; canonical term remains Household.

**Residence**:
The shared dwelling address of a Household (where the unit lives while displaced or at home of record for the unit). May omit house number; may record only an approximate origin (landmark, road, subdistrict) when the unit is homeless or has no formal address.
_Avoid_: Domicile (ambiguous), home address, mailing address.

**Housing Type**:
A master-data classification of the Household's Residence kind: owned home, rented, condo, apartment/dorm, or homeless (includes no house number / canal-side — not a separate code).
_Avoid_: House damage, shelter type, zone, no_house_number (folded into homeless).

**Identity-document address**:
The address printed on an Evacuee's identity document; it belongs to that person, not to the Household.
_Avoid_: Card address on Household, registered address (ambiguous with Residence).

**Registration**:
The initial administrative intake process that captures an evacuee's identity, household grouping, emergency contact, vulnerable-group flags, and free-form special needs.
_Avoid_: Check-in, triage, admission.

**Report-in**:
The Station 1 interview that confirms or edits Registration data for an evacuee whose stay status is `pre_registered`, then promotes that stay to `arriving`.
_Avoid_: Check-in, Registration (the broader intake process that also includes walk-in create), one-click status patch.

**Public Pre-registration**:
A self-service online intake flow that captures basic household and person identities before arrival. Two paths: (1) book a known shelter → Couch `pre_registered` hold; (2) Unassigned Registration when shelter is not yet chosen → Mongo `unassigned_registrations` until a shelter claims members into Evacuees.
_Avoid_: Online check-in, public registration (ambiguous with staff Station 1 walk-in), pre-admission, Central Pool (retired term).

**Medical Screening**:
A clinical evaluation conducted by healthcare personnel to assess surveillance symptoms (EWAR), vital signs, triage urgency, and ongoing medical conditions.
_Avoid_: Diagnosis, general checkup, registration.

**Triage Level**:
A 3-color clinical classification (Green, Yellow, Red) that dictates medical urgency and residential isolation or medical zone assignment.
_Avoid_: Priority code, track, severity score.

**Vulnerable Group**:
A master-data multi-select classification on the Evacuee (`vulnerable_groups[]`) for reporting, zoning hints, and care prioritization. Canonical seed codes include bedridden, dialysis, wheelchair, psychiatric, elderly_dependent, infant, young_child, pregnant, vision_impaired, hearing_impaired, disability_other, chronic_illness (`infant` and `young_child` are distinct; `disability_other` is the non-specific disability bucket beside vision/hearing/wheelchair/bedridden).
_Avoid_: Special Needs, handicaps, legacy codes `elderly`/`disabled` (migrate to `elderly_dependent`/`disability_other`).

**Special Needs**:
Free-form requests for accommodations or support an Evacuee wants (what they ask for), not a coded vulnerability taxonomy.
_Avoid_: Vulnerable Group, disability flags, structured diagnosis codes.

**Pet**:
An animal accompanying a Household, recorded on the household as `pets[]` with species `dog|cat|other` (free-text `notes` required when `other`) and optional `image_url`.
_Avoid_: Livestock catalog, standalone pet documents, hardcoding `bird`/`monkey` as species enums.

**Handover Slip**:
A routing slip or digital QR code token issued at intake to guide an evacuee between stations (Registration → Medical Screening → Zoning).
_Avoid_: Ticket, coupon, receipt.

## Accommodation & Movement

**Zoning**:
The allocation of an evacuee or household to a specific physical zone, room, or tent within the shelter facility.
_Avoid_: Bed booking, seating, housing.

**Check-in**:
The formal entry action and movement log that assigns a zone and transitions stay to `active`.
_Avoid_: Registration, arrival, Zone Arrival Confirmation.

**Zone Arrival Confirmation**:
The explicit confirmation that an Evacuee has physically reached their assigned zone/bed after check-in; persisted as stay status `room_confirmed` (after `active`).
_Avoid_: Check-in, Active, bed scan (implementation detail), RE_ENTERED.

**Arriving**:
The stay status of an evacuee who has completed initial registration and is physically on site, but awaits medical screening or zone assignment.
_Avoid_: Pending, queued, unregistered, ARRIVED_TRIAGE (stakeholder label only).

**Active**:
The stay status after Check-in with a zone assigned; used as one of the occupancy actuals (arrival-at-shelter / on-register-at-center). Zone Arrival Confirmation is a later status (`room_confirmed`), not a replacement for `active`.
_Avoid_: Checked-in, resident, admitted, “at bed” (that is Zone Arrival Confirmation).

**Unassigned Registration**:
A household-level pre-arrival intake recorded before any shelter is chosen. Persisted only in Mongo (`unassigned_registrations`); members are not Evacuees until a shelter claims them into Couch. Staff search this collection directly (no `public_persons` stub until claim). Partial claim leaves unclaimed members `open` for later intake. Does not count toward shelter Forecast occupancy until claimed.
_UI (th)_: ลงทะเบียนล่วงหน้าแบบไม่ระบุศูนย์.
_Avoid_: Central Pool, `central_pool_registration`, equating with Couch `pre_registered` holds for a known shelter, treating Mongo as SoR for checked-in Evacuees.
_Spec_: [CR-113](docs/changes/CR-113-unassigned-registration-mongo.md) (approved).

**Forecast Occupancy**:
Headcount of evacuees expected at the shelter for capacity planning: stay ∈ {`pre_registered`, `arriving`, `active`, `room_confirmed`, `temporary_leave`} on that shelter's Couch SoR. In-shelter public booking holds remain Couch `pre_registered`. Unassigned Registration Mongo documents are excluded until claimed. Excludes `transferred`, `checked_out`, `deceased`, `cancelled`. Spec: [CR-112](docs/changes/CR-112-registration-foundation-schema-stay.md) (approved).
_Avoid_: Single blended occupancy number, only-active count.

**Present Occupancy** (actual):
Headcount confirming the person is still on the shelter's books as present: stay ∈ {`active`, `room_confirmed`, `temporary_leave`}. `temporary_leave` remains Present because return is expected. Distinct from Forecast Occupancy and from In-zone Occupancy.
_Avoid_: Mixing forecast holds into “how many are here now” without labeling.

**In-zone Occupancy**:
Headcount of Evacuees with stay `room_confirmed` only (physically confirmed at assigned zone/bed). Dropped while on `temporary_leave`.
_Avoid_: Equating In-zone with Present.

## Interoperability & External Exchange

**Compound Scoped Role**:
A staff capability bound to one shelter in `_users.roles` as `{shelter_code}:{capability}` (with a matching `shelter:{code}` access gate), so one account may hold different duties in different shelters without privilege bleed.
_Avoid_: Global staff role, flat multi-shelter role list.

**Location Master**:
The authoritative register of shelter facilities published to partner systems with permanent, non-reusable location codes.
_Avoid_: Shelter directory, site list, place catalog.

**Partner Module**:
An external disaster management subsystem (e.g. M6 Resource Logistics, M7 Command Center) integrating with Smart Shelter via scoped tokens.
_Avoid_: Third-party app, consumer, external client.

**Administrative Code**:
The official Department of Provincial Administration (DOPA) hierarchical numerical codes for provinces (2 digits), districts (4 digits), and subdistricts (6 digits).
_Avoid_: Postal code, location text, geo string.

