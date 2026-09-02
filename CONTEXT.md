# Smart Shelter Domain Context

Canonical glossary and domain model vocabulary for the Smart Shelter disaster evacuation management system.

## People & Intake

**Evacuee**:
A displaced person seeking shelter, care, and basic necessities inside an evacuation shelter.
_Avoid_: Refugee, patient, client, customer.

**Household**:
A domestic unit of one or more evacuees arriving together, represented by a designated head of household.
_Avoid_: Family, group, tent party.

**Registration**:
The initial administrative intake process that captures an evacuee's identity, household grouping, emergency contact, and baseline physical special needs.
_Avoid_: Check-in, triage, admission.

**Medical Screening**:
A clinical evaluation conducted by healthcare personnel to assess surveillance symptoms (EWAR), vital signs, triage urgency, and ongoing medical conditions.
_Avoid_: Diagnosis, general checkup, registration.

**Triage Level**:
A 3-color clinical classification (Green, Yellow, Red) that dictates medical urgency and residential isolation or medical zone assignment.
_Avoid_: Priority code, track, severity score.

**Special Needs**:
Individual physical, assistive, or dietary accommodations (e.g. wheelchair, bedridden, oxygen, infant, pregnancy) required by an evacuee regardless of acute illness.
_Avoid_: Disability, illness, handicaps.

**Handover Slip**:
A routing slip or digital QR code token issued at intake to guide an evacuee between stations (Registration → Medical Screening → Zoning).
_Avoid_: Ticket, coupon, receipt.

## Accommodation & Movement

**Zoning**:
The allocation of an evacuee or household to a specific physical zone, room, or tent within the shelter facility.
_Avoid_: Bed booking, seating, housing.

**Check-in**:
The formal entry action and movement log that places an evacuee into an assigned zone, transitioning their stay status to active.
_Avoid_: Registration, arrival.

**Arriving**:
The stay status of an evacuee who has completed initial registration and is physically on site, but awaits medical screening or zone assignment.
_Avoid_: Pending, queued, unregistered.

**Active**:
The stay status of an evacuee currently residing in a designated shelter zone.
_Avoid_: Checked-in, resident, admitted.

## Interoperability & External Exchange

**Location Master**:
The authoritative register of shelter facilities published to partner systems with permanent, non-reusable location codes.
_Avoid_: Shelter directory, site list, place catalog.

**Partner Module**:
An external disaster management subsystem (e.g. M6 Resource Logistics, M7 Command Center) integrating with Smart Shelter via scoped tokens.
_Avoid_: Third-party app, consumer, external client.

**Administrative Code**:
The official Department of Provincial Administration (DOPA) hierarchical numerical codes for provinces (2 digits), districts (4 digits), and subdistricts (6 digits).
_Avoid_: Postal code, location text, geo string.

