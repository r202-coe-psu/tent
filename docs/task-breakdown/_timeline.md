---
title: "Task Breakdown — Dependencies & Timeline"
status: active
created: 2026-06-05
updated: 2026-07-15
note: deps maintained directly in Markdown. Schedule เคาะ 2026-06-09 · baseline T-47..55 · public-tier T-57..60 (CR-005) · topology/T-54 wording CR-033 2026-07-15
---

# Dependencies & Timeline

อะไร block อะไร + timeline (มิ.ย.–ส.ค. 2026, go-live ก.ย.). อ้าง [task module breakdown](_index.md).

## 0. Schedule Decision (ข้อสรุป 2026-06-09)

ทีม = **2 Lead + 4 teams × 3** (greenfield — มีเพียง CouchDB PoC, ยังไม่เริ่ม development).

| วันที่ | event |
| --- | --- |
| **10/06/2026** | Kickoff Lead + foundation เริ่มทันที (walking skeleton) |
| **17/06/2026** | Workshop ทีม → 4 teams เริ่มงาน |
| **31/08/2026** | In-scope เสร็จ (R2 + R3 + Family Search + governance) — เป้าหมายส่งมอบ |
| **ก.ย. 2026 (สัปดาห์ 1)** | Go-live ใช้งานจริง |
| **14/09/2026 (สัปดาห์ที่ 2 ก.ย.)** | **Hard deadline งาน feature** — deferred tail ต้องจบในกรอบนี้ ไม่มีงาน feature ใหม่เลยกว่านี้ |
| **หลัง 14/09 → ครบโครงการ 12 เดือน** | รับ feedback + แก้ไข (maintenance/bug-fix) จนสิ้นสุดโครงการ [ASSUMPTION ~มิ.ย. 2027 — ยืนยันกับสัญญา] |

**Scope สำหรับ go-live ก.ย.**

- **In-scope (จบ ส.ค.):** **Baseline FR-1–20 (T-47..T-55, ดู [00-baseline](00-baseline.md))** + R2 Foundation + R3 Operations + **Family Search (T-40/41)** core public feature + **Public Portal (T-57/58/59) + public `/donate` (T-60)** ตาม CR-005 + **T-43 RoPA/retention (minimal)** เพราะ public tier (family search/portal/donate) เปิด public = PII/data exposure จริง
- **Deferred (หลัง go-live, cap 14/09/2026):** EOC aggregate API (T-37/38), Open API (T-39), SOP simulation (T-42), inventory polish (T-45)

**Walking skeleton — Lead 2 คนต้องส่งก่อน 17/06** (greenfield risk): repo + branch/PR convention + CI/CD, auth/RBAC skeleton (T-01), Central CouchDB base schema + Central-first remote write / conflict design (T-02 ตั้งต้น; LAN Edge เป็น outage fallback เท่านั้น), 1 vertical slice end-to-end ให้ทีม copy pattern, seed data. ใช้ `docs/architecture/` + `docs/data/` เป็น input อย่า redesign จากศูนย์. **Remote-first CouchDB (active endpoint เดียว, Central→Edge failover, failback, conflict, RBAC) = tech risk #1 → Lead B เป็นเจ้าของ T-02 + T-54; deny PouchDB/local-first ([CR-033](../changes/CR-033-remote-first-architecture-program-index.md))**.

**เงื่อนไขฝั่งบริษัท (เน็ท):** P-02 (R3 design) ต้องเสร็จก่อน ก.ค. (ทีมแตะ R3 ~ต้น ก.ค.). P-03 ดึงเฉพาะ **ส่วน Family Search** มา design ล่วงหน้า; EOC/Open API design ยัง defer.

## 1. คอขวด (hub — block หลายตัว)

| Task | Module | Block กี่ตัว | block อะไร |
| --- | --- | --- | --- |
| **P-01** design (บริษัท) | pre | 3 | T-01/02/03 (ทั้ง R2 foundation) — ส่งแล้ว ไม่ block |
| **T-02** data model | Core | 9 | T-04, T-08, T-10, T-17, T-18, T-19 + baseline T-47/48/54 — fan-out ใหญ่สุด |
| **T-48** person registration | Baseline | 4 | T-49, T-50, T-53, T-55 (และ flow check-in T-51→T-52 ผ่าน T-50) |
| **T-11** stock ledger | C | 4 | T-12, T-13, T-14, T-15 |
| **T-14** stock dashboard | C | 3 | T-21 (donation reservation), T-23, T-31 |
| **T-31** resource calc engine | B | 4 | T-25 (meal plan), T-32, T-35, T-42 — cross-module hub |
| **T-44** UAT + handover | Core | 3 | T-46, Q-02, Q-03 |
| **all R3 เสร็จ** | gate | — | T-37 (EOC) — **deferred post-go-live**, ไม่อยู่บนเส้นวิกฤต ส.ค. แล้ว |

**เส้นวิกฤต (longest internal, scope ส.ค.):** `T-02 → T-11 → T-14 → T-31 → T-25 → T-26 → T-27` → (R3 gate) → `T-44`.
ตัด `T-37 → T-39` (EOC/Open API) ออกจากเส้นวิกฤต → **deferred post-go-live** → critical path สั้นลง ~11 WD.
**Family Search (T-04 → T-40 → T-41)** เป็น branch ขนานออกจาก household — **ไม่ทำให้เส้นวิกฤตยาวขึ้น** ใช้ capacity Team 1.
**Baseline (T-47..T-55)** รันขนานช่วง มิ.ย.–ก.ค. — ไม่อยู่บนเส้นวิกฤต stock chain แต่ **ต้องจบใน Foundation Gate (17 ก.ค.)** เพราะ flow หน้างาน (register→screen→check-in) เป็น precondition ของ occupancy data ที่ R3 ใช้; **T-54 Central-first offline sync/failback = tech risk #1** เริ่มทันทีหลัง skeleton.
Pre-production (P-0x) ส่งแล้ว/ดึงมาขนาน → **ไม่ใช่ external lead-time block** (เว้น P-02 ต้องเสร็จก่อน ก.ค.).

## 2. Dependency Graph

```mermaid
flowchart LR
  classDef hub fill:#fde68a,stroke:#d97706,stroke-width:2px;
  classDef crit fill:#fecaca,stroke:#dc2626,stroke-width:2px;
  classDef gate fill:#bbf7d0,stroke:#16a34a,stroke-width:2px;
  classDef design fill:#e5e7eb,stroke:#6b7280,stroke-dasharray:4 3;
  classDef deferred fill:#f3e8ff,stroke:#9333ea,stroke-dasharray:5 3;

  P01([P-01 design]):::design
  P03([P-03 design]):::design

  subgraph BL["Baseline FR-1–20 (มิ.ย.–ก.ค.)"]
    T47[T-47 shelter master]
    T48[T-48 person reg]:::hub
    T49[T-49 screening]
    T50[T-50 person ID/QR]
    T51[T-51 search+checkin]
    T52[T-52 dashboard v1]
    T53[T-53 export+audit]
    T54[T-54 central-first sync]:::crit
    T55[T-55 fallback/import]
  end

  subgraph R2["R2 — Foundation (ส.ค. ต้น)"]
    T01[T-01 RBAC]
    T02[T-02 data model]:::crit
    T03[T-03 API freeze]
    T04[T-04 household]
    T05[T-05 ID/QR]
    T06[T-06 search+checkin]
    T07[T-07 pet/asset]
    T08[T-08 zone def]
    T09[T-09 zone alloc]
    T10[T-10 supply catalog]
    T11[T-11 stock ledger]:::crit
    T12[T-12 distribute]
    T13[T-13 transfer]
    T14[T-14 stock dashboard]:::crit
    T15[T-15 donor predeclare]
    T16[T-16 intake audit]
    T17[T-17 kitchen groundwork]
    T18[T-18 SOP groundwork]
    T19[T-19 report-case groundwork]
    G2{{T-20 Foundation Gate}}:::gate
  end

  subgraph R3["R3 — Operations (ส.ค. กลาง-ปลาย)"]
    T21[T-21 reservation]
    T22[T-22 cut-off]
    T23[T-23 redirect]
    T24[T-24 transparency]
    T25[T-25 meal plan]
    T26[T-26 requisition]
    T27[T-27 meal service]
    T28[T-28 volunteer reg]
    T29[T-29 skill match]
    T30[T-30 SOP config]
    T31[T-31 resource calc]:::crit
    T32[T-32 calc dashboard]
    T33[T-33 report-case UI]
    T34[T-34 referral]
    T35[T-35 calc backbone]
    T60[T-60 public /donate]
    T57[T-57 public landing]
    T58[T-58 public /shelters]
    T59[T-59 public FAQ]
    G3{{T-36 Operations Gate}}:::gate
  end

  subgraph R4["R4 — Integration (Family Search: ส.ค. · EOC/Open API: deferred ≤14 ก.ย.)"]
    T37[T-37 EOC aggregate API]:::deferred
    T38[T-38 EOC API-key/scope]:::deferred
    T39[T-39 Open API]:::deferred
    T40[T-40 search consent]
    T41[T-41 family search]
    T42[T-42 SOP simulation]:::deferred
    T43[T-43 RoPA/retention]
    T44[T-44 UAT+handover]:::hub
    T45[T-45 inventory polish]:::deferred
    T46[T-46 Handover Gate]:::gate
    Q01[Q-01 deploy automation]
    Q02[Q-02 support buffer]
    Q03[Q-03 user manual]
  end

  P01 --> T01 & T02 & T03
  T02 --> T47 & T48 & T54
  T01 --> T48
  T48 --> T49 & T50 & T53 & T55
  T50 --> T51
  T51 --> T52
  T02 --> T04 & T08 & T10 & T17 & T18 & T19
  T04 --> T05 & T07 & T40
  T05 --> T06
  T08 --> T09
  T10 --> T11
  T11 --> T12 & T13 & T14 & T15
  T15 --> T16

  T14 --> T21 & T23 & T31
  T16 --> T21 & T24
  T21 --> T22
  T22 --> T23
  T17 --> T25
  T30 --> T31
  T31 --> T25 & T32 & T35 & T42
  T12 --> T26
  T25 --> T26
  T26 --> T27
  T18 --> T28 & T30
  T28 --> T29
  T19 --> T33 & T34

  T15 --> T60
  T22 --> T60
  T52 --> T57
  T35 --> T57
  T57 --> T58
  T47 --> T58
  T03 --> T59

  G2 -. all R2 .-> R3
  G3 -. all R3 .-> T37
  T37 --> T38 & T39
  P03 --> T39 & T41
  T40 --> T41
  T44 --> T46 & Q02 & Q03
```

> สีแดง = เส้นวิกฤต · สีส้ม = hub · เขียว = gate · เทา dashed = design (บริษัท) · ม่วง dashed = **deferred post-go-live**.
> `G2/G3 -. all .->` = ต้องปิดทั้ง phase ก่อนข้าม (integration gate). **Foundation Gate (T-20) ครอบ Baseline (T-47..55) ด้วย.**
> Family Search (T-40/41) + T-43 = **เก็บใน scope ส.ค.** (core public feature + PII compliance) แม้อยู่ subgraph R4.
> **Public tier (CR-005):** T-57/58/59 (Public Portal, [12-public](12-public.md)) + T-60 (public `/donate`, [04-donation](04-donation.md)) = R3 — อ่าน aggregate read-model (T-35) เท่านั้น, metric กั้นหลัง kill-switch flag, no person-level; ไม่อยู่บนเส้นวิกฤต stock chain แต่ผูก PII/data-governance review (T-43) + redaction whitelist (T-01).

## 3. Timeline (Gantt)

```mermaid
gantt
  title Smart Shelter — Build 10 มิ.ย.–31 ส.ค. 2026 · Go-live ก.ย.
  dateFormat YYYY-MM-DD
  axisFormat %m/%d

  section Pre-design (บริษัท)
  P-01 R2 design (ส่งแล้ว)          :done, p1, 2026-05-25, 2026-06-09
  P-02 R3 design (ก่อน ก.ค.)         :crit, p2, 2026-06-10, 2026-06-30
  P-03 Family Search design          :p3, 2026-06-15, 12d

  section Foundation / Walking Skeleton (Lead)
  Kickoff Lead                       :milestone, k0, 2026-06-10, 0d
  repo+CI/CD+auth+CouchDB schema      :crit, sk, 2026-06-10, 7d
  T-01/02/03 RBAC+data model+API freeze :crit, t013, 2026-06-10, 12d
  Workshop — 4 teams เริ่ม            :milestone, w1, 2026-06-17, 0d

  section Baseline FR-1–20 (มิ.ย.–ก.ค.)
  T-48/49 person reg + screening      :bl1, 2026-06-17, 10d
  T-50/51 ID·QR + search/check-in     :bl2, after bl1, 8d
  T-54 central-first sync/failback    :crit, bl3, 2026-06-17, 12d
  T-52/53 dashboard v1 + export/audit :bl4, after bl2, 8d
  T-47/55 shelter master + fallback   :bl5, 2026-06-24, 8d

  section R2 Foundation (มิ.ย.–ก.ค.)
  household + zone (T-04..09)         :t0409, 2026-06-17, 18d
  T-11 stock ledger (crit)           :crit, t11, after t013, 5d
  T-14 stock dashboard (crit)        :crit, t14, after t11, 4d
  donation intake (T-15/16)          :t1516, after t11, 6d
  groundwork R3 (T-17/18/19)         :gw, after t013, 8d
  T-20 Foundation Gate               :milestone, g2, 2026-07-17, 0d

  section R3 Operations (ก.ค.–ส.ค.)
  T-31 resource calc (crit)          :crit, t31, after t14, 5d
  T-25 meal plan (crit)              :crit, t25, after t31, 5d
  T-26/27 kitchen (crit)             :crit, t2627, after t25, 6d
  donation flows (T-21..24)          :t2124, 2026-07-21, 12d
  volunteer/SOP (T-28..32)           :t2832, 2026-07-21, 16d
  report-case/referral (T-33/34)     :t3334, 2026-07-25, 10d
  public tier — portal+/donate (T-57..60, CR-005) :pub, 2026-08-01, 18d
  T-36 Operations Gate               :milestone, g3, 2026-08-22, 0d

  section Family Search (core public · ขนาน)
  T-40 search consent                :fs1, after t0409, 5d
  T-41 family search                 :fs2, after fs1, 6d
  T-43 RoPA/retention (minimal)      :t43, 2026-08-01, 6d

  section UAT + Go-live (ส.ค.–ก.ย.)
  Q-01 deploy automation             :q1, 2026-08-10, 6d
  T-44 UAT + hardening + handover    :crit, t44, 2026-08-22, 9d
  Q-03 user manual + runbook         :q3, 2026-08-22, 8d
  In-scope เสร็จ (เป้าหมาย)           :milestone, dl, 2026-08-31, 0d
  Go-live ใช้งานจริง                  :milestone, gl, 2026-09-01, 0d

  section Deferred + Support (cap 14/09)
  T-37/38 EOC aggregate API          :def1, 2026-09-01, 6d
  T-39 Open API                      :def2, after def1, 4d
  T-42 SOP sim · T-45 polish         :def3, 2026-09-01, 8d
  Q-02 support buffer                :q2, 2026-09-01, 10d
  Hard deadline (สัปดาห์ที่ 2 ก.ย.)    :milestone, hd, 2026-09-14, 0d
```

> **เส้นวิกฤต (in-scope, จบ ส.ค.):** walking skeleton (T-01/02/03) → T-11 → T-14 → T-31 → T-25 → T-26/27 → (R3 gate) → T-44 UAT → ส่งมอบ 31 ส.ค.
> **Baseline (T-47..55)** รันขนาน มิ.ย.–ก.ค. ต้องจบใน Foundation Gate; T-54 remote-first Central→Edge failover/failback = tech risk #1 ([CR-033](../changes/CR-033-remote-first-architecture-program-index.md)).
> Family Search (T-40/41) = branch ขนานออกจาก household — core public feature, อยู่ใน scope. T-43 (minimal) บังคับเพราะ public PII.
> **Greenfield:** 10–17 มิ.ย. Lead ส่ง walking skeleton ก่อนทีม 12 คนเข้า; remote-first CouchDB, Edge fallback, failback และ conflict = technical risk อันดับ 1 (deny PouchDB).
> **Deferred** (EOC / Open API / SOP sim / polish) = หลัง go-live, **hard deadline งาน feature 14/09/2026** (สัปดาห์ที่ 2 ก.ย.) — หลังจากนั้นเป็น maintenance/feedback จนครบโครงการ 12 เดือน. P-02 ต้องเสร็จก่อน ก.ค. มิฉะนั้นทีมรอ design.
> วันใน gantt = ประมาณการ sequencing บนเส้นวิกฤต — งานราย module รันขนาน (4 teams × 3 + Lead pair, part-time academic).
