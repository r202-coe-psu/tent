---
title: Edge disaster continuity — operational idea (parked)
status: idea / elevated-via-CR-064
created: 2026-08-12
updated: 2026-08-12
note: >
  แนวคิดปฏิบัติการ LAN edge — elevate ผ่าน CR-064 (proposed) + T-54 Package B.
  Topology binding ยังอยู่ที่ docs/data/* จนกว่า CR-064 จะ approved แล้ว reconcile.
  OD-1..OD-5 ล็อกแล้ว (2026-08-12).
related:
  - docs/changes/CR-064-edge-disaster-continuity.md
  - docs/changes/CR-033-remote-first-architecture-program-index.md
  - docs/task-breakdown/00-baseline.md (T-54)
  - docs/features/offline-fallback-flow-spec.html
  - docs/data/data-model.md §1 §6 §8
  - docs/data/api-contract.md §1 §3
---

# Edge disaster continuity — operational idea (parked)



## สรุป (TL;DR)

บันทึกแนวปฏิบัติการ: **แจก mini PC ที่ image พร้อมก่อนเหตุการณ์ → warm sync central→edge ตลอดช่วงเปิดศูนย์ → WAN ล่มแล้ว network-only cutover ไป edge (login ใหม่ได้) → WAN กลับแล้ว sync edge→central + ops UI สถานะ → ตัดกลับ central** · ไม่รวม FastAPI/Mongo บน edge · ไม่ scale user บน edge · **elevate ผ่าน [CR-064](../changes/CR-064-edge-disaster-continuity.md)** (proposed) + T-54 Package B · ยังไม่ supersede data-model/api-contract จนกว่า CR approve

## 1. Intent

รองรับศูนย์พักพิงที่ **เปิด–ปิดตามสถานการณ์ภัยพิบัติ** โดย staff ทำงานต่อได้เมื่อ WAN หรือ central ล่ม โดยใช้ **edge CouchDB บน LAN ของศูนย์** ที่เตรียมไว้ล่วงหน้า — ไม่พึ่ง local write queue / PouchDB บน device (CR-033)

## 2. Locked assumptions (จากบทสนทนา 2026-08-12)


| ID  | Assumption                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| A1  | **ไม่ scale / สร้าง user บน edge** — user provision ที่ central ก่อนเปิดศูนย์; edge ได้เฉพาะ filtered `_users` สำหรับ login |
| A2  | DevOps แจก **mini computer + router** ที่ install/setup ครบก่อนเหตุการณ์                                                    |
| A3  | ระหว่างสถานการณ์ (WAN ยังใช้ได้) mini PC **online** เพื่อ sync จาก central ลง edge ตลอด                                     |
| A4  | Sync เฉพาะ **DB ของศูนย์นั้น** + **global DB ที่แชร์ระหว่างศูนย์** (`registry`, `catalog`)                                  |
| A5  | ตอนล่ม: ใช้ระบบบน **local network**; DevOps ชี้ **domain เดิม** ไป edge (network-only); **login ใหม่บน edge ได้** (ไม่บังคับคง session เดิม) |
| A6  | ตอน WAN กลับ: sync data กลับ central → แจ้งทุกศูนย์กลับไปใช้ central → วน loop เดิม                                         |
| A7  | Edge เป็น **LAN continuity replica** ไม่ใช่ normal client hub / ไม่ใช่ public plane hub                                     |




## 3. Operational loop

```
[Pre-event]
  image mini PC + router · provision shelter on central · seed users ·
  install edge · wire replication · dry-run cutover

[Shelter open / WAN up]
  staff → central (ปกติ)
  central → edge continuous sync (shelter_* + registry + catalog + filtered _users)
  mini PC stays online (warm replica)

[WAN / central down]
  cut traffic to edge (same domain on LAN)
  staff R/W shelter_* on edge only
  /api/v1/* และ public plane = degraded / unavailable

[WAN back]
  edge → central backlog for shelter_*
  verify lag / conflicts
  cut all shelters back to central
  staff login ใหม่บน central
  worker/Mongo catch-up for public projections

[Shelter close]
  stop replication · wipe edge appliance · central retention clock
```



## 4. Data plane (intended)


| DB / store                                   | While WAN up                                                 | During edge-only       | After WAN restore                            |
| -------------------------------------------- | ------------------------------------------------------------ | ---------------------- | -------------------------------------------- |
| `shelter_{code}`                             | app → central; replicate **central→edge**                    | app → edge only        | **edge→central** backlog; app → central      |
| `registry`                                   | app read central; **central→edge**                           | app read edge replica  | app read central (master)                    |
| `catalog`                                    | app read central; **central→edge**                           | app read edge replica  | app read central (master)                    |
| `_users`                                     | master central; **filtered central→edge** (`shelter:{code}`) | login via edge replica | re-login central; no edge→central user merge |
| Mongo / public / FastAPI                     | worker from central                                          | stale or down          | catch-up after central heal                  |
| `/api/v1/*` (users, export, mint, provision) | central only                                                 | **unavailable**        | resume on central                            |


**Invariant:** active write target = **หนึ่ง endpoint ต่อเวลา** — ห้ามเขียน central และ edge พร้อมกัน

## 5. Out of scope (explicit)

- สร้าง / แก้ user / เปลี่ยนรหัสผ่านบน edge
- Merge `_users` จากหลาย edge กลับ central
- Offline local write queue หรือ PouchDB บน device
- Public donation / family-search / EOC aggregate ผ่าน edge
- Cross-shelter transfer / global dashboard ตอนเป็น edge islands
- การเปิดศูนย์ใหม่ตอน WAN ล่ม (mint/provision = central-only)



## 6. Locked decisions (2026-08-12)

| ID | Decision | Implication |
| --- | --- | --- |
| **OD-1** | Edge image = **staff stack ครบ** (CouchDB + nginx `/couch` + staff SPA Node) — **ยกเว้น FastAPI + MongoDB** | Public plane ไม่รันบน edge; `/api/v1` central-only ยัง degraded ตอน edge-only |
| **OD-2** | Failover = **network-only** — router/DNS ชี้ domain เดิมไป edge; app ไม่สลับ `ActiveEndpoint` เอง | C1–C3 (app-aware probe/switch) **ลด / ไม่ทำ**; โฟกัส cutover ที่ LAN + login บน edge |
| **OD-3** | Cutover **ยอมให้ login ใหม่** — ไม่บังคับคง `_session` จาก central ข้ามไป edge | Same-domain ยังมีประโยชน์เรื่อง URL/bookmark แต่ cookie continuity ไม่ใช่ hard req; ต้องมี runbook “login ใหม่บน edge / login ใหม่ตอนกลับ central” |
| **OD-4** | Cutback / continuity มองผ่าน **ops UI**: (1) หน้า central เห็นสถานะ **shelter ทีละศูนย์** (2) ที่ศูนย์ staff เห็นสถานะ **WAN** | เกณฑ์ lag/conflict + ใครประกาศ cutback ผูกกับ UI นี้ (รายละเอียด SLO ลงใน CR/T-54) |
| **OD-5** | Track = **เปิด CR ใหม่** (ต่อ CR-033 follow-up) + **ขยาย T-54** + **sync ขึ้น Notion** | ✅ [CR-064](../changes/CR-064-edge-disaster-continuity.md) proposed · T-54 Package B · Notion sync |



## 7. Gap checklist (สถานะ ณ 2026-08-12)

สถานะ runtime ปัจจุบัน = **central-only** (CR-033 Package 8) · edge orchestration = **CR-064 / T-54 Package B** (proposed)

### 7.0 Decisions


| #   | รายการ | Status |
| --- | --- | --- |
| 0.1 | OD-1 image = staff stack ยกเว้น FastAPI/Mongo | ✅ locked |
| 0.2 | OD-2 network-only | ✅ locked |
| 0.3 | OD-3 login ใหม่ได้ (ไม่บังคับ cookie continuity) | ✅ locked |
| 0.4 | OD-4 ops UI สถานะ shelter + WAN ที่ศูนย์ | ✅ locked (รายละเอียดใน CR-064) |
| 0.5 | OD-5 CR + ขยาย T-54 + Notion | ✅ [CR-064](../changes/CR-064-edge-disaster-continuity.md) proposed · T-54 updated · Notion sync |




### 7.A Infra / DevOps


| #   | รายการ                                               | Pri |
| --- | ---------------------------------------------------- | --- |
| A1  | Edge appliance image + bootstrap ตาม `shelter_code`  | P0  |
| A2  | Router / LAN runbook (DHCP, DNS, firewall, `/couch`) | P0  |
| A3  | Same-domain DNS cutover + ทดสอบ login ใหม่บน edge        | P0  |
| A4  | Staging dry-run ก่อนฤดูเสี่ยง                        | P1  |
| A5  | Replicator credentials / rotation                    | P1  |
| A6  | Monitor `_up`, replicator lag, disk                  | P1  |
| A7  | Wipe edge ตอนปิดศูนย์                                | P1  |




### 7.B Data / replication


| #   | รายการ                                         | Pri |
| --- | ---------------------------------------------- | --- |
| B1  | Continuous central→edge `shelter_{code}`       | P0  |
| B2  | Continuous central→edge `registry` + `catalog` | P0  |
| B3  | Filtered `_users` (`shelter:{code}`)           | P0  |
| B4  | edge→central backlog ตอน WAN กลับ              | P0  |
| B5  | `_security` + design docs parity บน edge       | P0  |
| B6  | Warm view indexes บน edge                      | P1  |
| B7  | Conflict / no-duplicate tests ตอน failback     | P1  |
| B8  | ปิดศูนย์ = หยุด replication + purge + wipe     | P2  |




### 7.C App / failover / ops UI


| #   | รายการ | Pri | หมายเหตุ |
| --- | --- | --- | --- |
| C1 | `ActiveEndpoint` app-aware switch | — | **ตัด** ตาม OD-2 = network-only |
| C2 | Probe central แล้วค่อย edge ใน app | — | **ตัด** ตาม OD-2 |
| C3 | App-driven failback switch | — | **ตัด**; failback = network cutback + re-login |
| C4 | **Ops UI (central):** สถานะต่อ shelter (WAN / edge-only / sync lag / ready-to-cutback) | P0 | OD-4 |
| C5 | **UI ที่ศูนย์:** แสดงสถานะ WAN (ขึ้น/ลง) ให้ staff เห็น | P0 | OD-4 |
| C6 | ปิดหรือบอกชัดฟีเจอร์ที่ต้อง WAN / public | P1 | |
| C7 | Runbook + UX: login ใหม่หลัง cutover / หลัง cutback | P0 | OD-3 |




### 7.D Auth / users


| #   | รายการ | Pri | หมายเหตุ |
| --- | --- | --- | --- |
| D1 | Login บน edge หลัง network cutover (expected path) | P0 | OD-3 — ไม่พึ่ง session จาก central |
| D2 | Edge cookie ห้ามเรียก `/api/v1` (central-only) | P0 | |
| D3 | Re-login ตอนกลับ central หลัง cutback | P0 | OD-3 |
| D4 | Pre-provision users ก่อนเปิดศูนย์ (ops) | P0 | |
| D5 | บล็อก user admin / เปลี่ยนรหัสตอน edge mode | P1 | |
| D6 | ทดสอบ user ใหม่ที่ central โผล่บน edge ภายใน SLA | P1 | |




### 7.E Provisioning / lifecycle


| #   | รายการ                                                   | Pri |
| --- | -------------------------------------------------------- | --- |
| E1  | บันทึก/ใช้ `edge_url` จริงตอนเปิดศูนย์                   | P0  |
| E2  | Provision สร้าง `_replicator` docs อัตโนมัติ             | P0  |
| E3  | Provision ตอน edge ยังไม่ online → `pending` + reconcile | P1  |
| E4  | Close shelter ผูกหยุด sync + wipe                        | P1  |
| E5  | Inventory ความพร้อม edge ต่อศูนย์                        | P1  |




### 7.F Central services / public plane


| #   | รายการ                                                | Pri |
| --- | ----------------------------------------------------- | --- |
| F1  | เอกสาร/UX: ช่วง edge-only อะไรใช้ได้/ไม่ได้           | P0  |
| F2  | Public plane degraded (worker/Mongo ค้างจน sync กลับ) | P0  |
| F3  | ไม่ให้ edge อ้างว่า public ทำงานปกติ                  | P1  |
| F4  | งานข้ามศูนย์ใช้ไม่ได้ตอน edge islands                 | P1  |
| F5  | หลัง failback รอ worker catch-up ก่อนประกาศระบบครบ    | P1  |




### 7.G Testing / runbook


| #   | รายการ                                                      | Pri |
| --- | ----------------------------------------------------------- | --- |
| G1  | Event runbook 5 เฟส (pre / warm / cutover / heal / cutback) | P0  |
| G2  | Chaos drill: ตัด WAN → เขียน edge → เปิด WAN → ตรวจ central | P0  |
| G3  | E2E login บน edge ด้วย filtered `_users`                    | P0  |
| G4  | Test matrix ตาม T-54                                        | P0  |
| G5  | เกณฑ์ lag / สัญญาณ cutback                                  | P1  |
| G6  | UAT continuity (FR-17/18)                                   | P1  |




## 8. Suggested sequencing (เมื่อเริ่มทำ)

1. **Approve CR-064** → reconcile api-contract / data-model / offline-fallback
2. A1–A3 + B1–B5 + E1–E2 — มี edge อุ่น + login ได้ (network-only)
3. D1–D4 + C7 — cutover/cutback ด้วย re-login
4. C4–C5 (OD-4 ops UI) + F1–F2 + G1–G2 — สถานะมองเห็น + degraded + drill

## 9. Relation to existing specs

| Doc | Relationship |
| --- | --- |
| [CR-033](../changes/CR-033-remote-first-architecture-program-index.md) | Master remote-first; follow-up edge orchestration → CR ใหม่ตาม OD-5 |
| [T-54](../task-breakdown/00-baseline.md) | ขยายให้ครอบ network-only cutover + ops UI + failback tests |
| [data-model.md](../data/data-model.md) / [api-contract.md](../data/api-contract.md) | Binding — อย่า supersede จนกว่า CR approve; note: api-contract เคยเขียน app-aware → CR ต้อง reconcile กับ OD-2 |
| [offline-fallback-flow-spec.html](./offline-fallback-flow-spec.html) | App-aware state machine — ลด scope ตาม OD-2; เก็บ UX สถานะ WAN / degraded |

## 10. Acceptance preview (เมื่อ elevate เป็น work item)

1. Pre-event image (OD-1) + warm sync ผ่าน dry-run staging
2. Network cutover ใช้ domain เดิมบน LAN; staff **login ใหม่** บน edge แล้วเขียน `shelter_*` ได้
3. Failback: backlog ขึ้น central ไม่ duplicate; staff **login ใหม่** บน central หลัง cutback
4. Ops UI เห็นสถานะต่อ shelter + ที่ศูนย์เห็น WAN; public/central-only แสดง degraded ชัด
5. Chaos drill (G2) ผ่าน + runbook ชัด

## Decision log

| Date | Note |
| --- | --- |
| 2026-08-12 | Parked idea: mini PC + warm sync + same-domain LAN cutover + failback; ตัด scale user บน edge |
| 2026-08-12 | **Locked OD-1..OD-5:** staff stack ยกเว้น FastAPI/Mongo · network-only · re-login OK · ops UI shelter+WAN · track = CR + T-54 + Notion |
| 2026-08-12 | Elevated: [CR-064](../changes/CR-064-edge-disaster-continuity.md) proposed · T-54 Package B · Notion T-54 sync |

