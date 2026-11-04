---
title: "Postmortem: Rate limit ถูกเขียนในโค้ดแทน nginx"
date: 2026-10-26
updated: 2026-10-26
related: [CR-188, "issue #627"]
source: https://claude.ai/artifact/QQ9h3hjVntEBLCK2nAJ8a2
---

# Postmortem: Rate limit ถูกเขียนในโค้ดแทน nginx

## สรุป

Rate limit ถูกเขียนเป็นโค้ดในแอป (BFF in-memory + FastAPI) อยู่ราว 4 เดือน (2026-06-20 ถึง 2026-10-23) ก่อนย้ายไป nginx `limit_req` ตาม CR-188 สาเหตุหลักคือ spec ขอ rate limit ตั้งแต่วันแรก (2026-06-10) แต่ไม่เคยกำหนดว่าทำที่ชั้นไหน และบางฉบับสั่งให้ทำในแอปตรง ๆ

- **ต้นทางของ spec:** commit แรก ๆ วันที่ 06-10 และ 06-11 (บัญชี net-lynx) เขียนแค่ "ต้อง rate-limit" ไม่ระบุชั้น ส่วนฉบับที่ระบุชั้นกลับเขียนว่า "ทำที่ FastAPI"
- **โค้ดแรก:** `287456a34` (Thanutham, 06-20) เพิ่ม `RateLimiter` in-memory ใน BFF โดยไม่อ้าง spec ใด จากนั้น CR หลายฉบับก็สั่งให้ "ใช้ RateLimiter ที่มีอยู่แล้ว"
- **กว่าจะมี spec ที่เอ่ยถึง nginx:** 2026-10-17 (CR-169) หลัง Soravit เปิด issue #627 และ CR-188 ได้รับอนุมัติ 2026-10-23
- **บทเรียนหลัก:** ข้อกำหนดที่เป็นเรื่อง cross-cutting (rate limit, CORS, TLS, logging) ต้องกำหนดชั้นไว้ใน ADR ตั้งแต่ช่วง grill และ spec ห้ามระบุชื่อคลาสหรือวิธี implement

## ผลกระทบ

ผู้ใช้ staging ประมาณ 10 คนโดน 429 พร้อมกัน และทีมต้องรื้อ limiter ออกจาก BFF และ FastAPI พร้อมยกเลิก requirement จาก CR ประมาณ 13 ฉบับ (ตามที่ CR-188 บันทึกไว้)

| ปัญหา | สาเหตุ | เกี่ยวกับการเลือกชั้นไหม |
| --- | --- | --- |
| staging ทุกคนโดน 429 | Cloudflare Tunnel ทำให้ `$remote_addr = 127.0.0.1` ทุก request ทุกคนจึงใช้ bucket เดียวกัน (access log ราว 1.11 ล้าน request) | ไม่ตรง ๆ เป็นปัญหาการระบุตัว client ย้ายไป nginx ก็ยังต้องตั้ง `realip` |
| เพดานจริงสูงเป็น 3 เท่า | in-memory Map แยกกันต่อ process เมื่อตั้ง `WEB_CONCURRENCY=3` | ตรง เป็นจุดอ่อนของ limiter ในแอป |
| ต้องมีสวิตช์ปิดสำหรับ e2e | limiter ฝังในโค้ด ต้องเพิ่ม `RATE_LIMIT` env (CR-160) | ตรง |
| ทุก request ต้องเข้า Node ก่อนถูกตัด | limiter อยู่หลัง reverse proxy | ตรง |
| ต้องยกเลิกกฎที่ผูกกับตัวตน | กฎต่อเบอร์, ต่อ nonce, ต่อ kiosk device, ต่อ token nginx ทำไม่ได้ | ตรง spec ออกแบบกฎที่บังคับให้เป็นโค้ด |

ตัวเลขและสาเหตุในตารางมาจากส่วน "Why" ของ CR-188 ยังไม่ได้ตรวจกับ log จริง

## Timeline

เรียงจากเก่าไปใหม่ตามลำดับเหตุการณ์ เวลาเป็น +07:00 ยกเว้นที่ระบุ Z

| วันที่ | Commit / Issue | ผู้เขียน | ชั้นที่สั่ง/ทำ | เกิดอะไร |
| --- | --- | --- | --- | --- |
| 2026-06-10 14:15 | `cebd0925e` | net-lynx | ไม่ระบุ | spec แรกที่พูดถึง rate-limit (task-breakdown T-15, T-38, T-39) |
| 2026-06-10 14:36 | `b172e068d` | net-lynx | ไม่ระบุ | PRD NFR-15/NFR-24 "ต้อง rate-limit + CAPTCHA + OTP" |
| 2026-06-10 17:59 | `c53704dec` | net-lynx | FastAPI | "rate-limit + aggregate-only ทำที่ FastAPI" (ไฟล์ถูกลบ 06-11) |
| 2026-06-11 14:51 | `3ffc193fa` | net-lynx | ไม่ระบุ | api-contract เพิ่ม `RATE_LIMITED 429` ต่อ IP และต่อเบอร์ |
| 2026-06-20 02:58 | `287456a34` | Thanutham | BFF | **โค้ดแรก** `RateLimiter` in-memory ไม่อ้าง spec |
| 2026-07-09 16:46 | `46535f2f0` | net-lynx | FastAPI | limiter แรกใน FastAPI 30 ครั้ง/นาที/IP |
| 2026-07-21 18:13 | `30211019f` | net-lynx | BFF + FastAPI | CR-044 "SvelteKit retains captcha/rate-limit proxy" |
| 2026-08-19 | `46d4b890a` | Kunanon Nusaeng | BFF + FastAPI | CR-080 บันทึก as-built สองชั้นซ้อนกัน |
| 2026-09-12 18:05 | `e476553e0` | Soravit | BFF | CR-122 "ใช้ RateLimiter ที่มีอยู่แล้วใน codebase" |
| 2026-09-29 23:31 | `56aef4e77` | NetLynx | แอป in-memory | CR-141 FR-20 "นับฝั่งเซิร์ฟเวอร์ in-memory" |
| 2026-10-11 14:31 | `1cc13b1e9` | Soravit | BFF | CR-160 สวิตช์ `RATE_LIMIT` สำหรับ e2e |
| 2026-10-17 04:53Z | issue #627 | Soravit | nginx | เสนอตัด limiter ออกจากแอป ย้ายไป Nginx |
| 2026-10-17 17:45 | `5fa4f4677` | NetLynx | nginx | CR-169: spec แรกที่เอ่ย nginx `limit_req` |
| 2026-10-18 16:45 | `a316d2e9d` | kanjicool | BFF | CR-173 สั่ง limiter ใหม่ในแอป **หลังเปิด #627** |
| 2026-10-20 09:15 | `e39e3abb1` | Soravit | BFF | CR-175 สั่ง limiter 60/นาที/IP **หลังเปิด #627** |
| 2026-10-23 20:13 | `6d2a5c9c5` | shuwern | nginx | อนุมัติ CR-188 |
| 2026-10-23 20:23–20:27 | `c76835d37` `1964bb969` `8f7f876ff` | shuwern | nginx | ลบ limiter ใน BFF/FastAPI เพิ่ม nginx zones (PR #788) |
| 2026-10-23 21:59 | `2262e51e4` | shuwern | nginx | ปรับ zone เป็น 10000 r/min (PR #793) |

## ต้นเหตุ: spec พลาดตรงไหน

พบ 5 จุดที่เสริมกัน จุดแรกเปิดช่องว่าง ส่วนอีก 4 จุดทำให้แพตเทิร์นในแอปติดแน่นขึ้นเรื่อย ๆ

1. **ไม่เคยกำหนดชั้นใน PRD หรือ ADR** NFR-15 เขียนแค่ "ต้อง rate-limit + CAPTCHA + OTP" (`docs/prd/phase-r2-foundation.md:272`) จนถึง 2026-10-17 ไม่มี ADR หรือ spec ไหนเอ่ยถึง nginx คนทำเลยเลือกชั้นที่ตัวเองคุมได้ คือโค้ด
2. **spec บางฉบับสั่งชั้นแอปตรง ๆ**
    - `c53704dec`: "rate-limit + aggregate-only ทำที่ FastAPI"
    - CR-044:29: "SvelteKit retains captcha/rate-limit proxy"
    - CR-141:113: "นับฝั่งเซิร์ฟเวอร์ in-memory"
3. **spec ระบุวิธี implement แทนผลลัพธ์** CR-122:66 สั่ง "ใช้ RateLimiter ที่มีอยู่แล้วใน codebase" และ CR-173 FR-7 สั่ง "limiter ใหม่แยกจาก limiter อื่น" การอ้างคลาสที่มีอยู่ทำให้สิ่งที่เกิดขึ้นเองกลายเป็นมาตรฐาน
4. **spec เขียนตามโค้ด (as-built) แทนที่จะกำหนดก่อน** task-breakdown 04-donation.md:84 เขียนว่า "rate-limit ต่อ IP ที่มีอยู่แล้ว" และ CR-080 บันทึกว่ามี BFF 3/นาที ซ้อน FastAPI 30/นาที โดยไม่ตั้งคำถามว่าควรอยู่ตรงนั้นไหม
5. **กฎที่ผูกกับตัวตน** ต่อเบอร์ (CR-005/070/092/173), ต่อ nonce (CR-141), ต่อ kiosk device หรือ primary (CR-151/163) กฎพวกนี้บังคับให้ต้องเป็นโค้ดตั้งแต่ตอนออกแบบ ไม่มีฉบับไหนถามว่าแค่ต่อ IP พอหรือไม่

สิ่งที่ทำให้ปัญหาลากยาวคือไม่มีกลไกหยุด spec ที่ไปทางเดิม หลังเปิด issue #627 ยังมี CR-173 (10-18) และ CR-175 (10-20) สั่ง limiter ในแอปเพิ่มอีก เพราะทิศใหม่อยู่แค่ใน issue ไม่ได้อยู่ใน spec กลาง

## ช่วง grill: หลุดตรงนั้นจริงไหม

หลักฐานสนับสนุนว่าช่องว่างเกิดตอน grill แต่ grill ไม่ใช่จุดเดียวที่ควรจะจับได้ มีอีกอย่างน้อย 2 ด่านที่ปล่อยให้ผ่านไป

**ที่สนับสนุนสมมติฐาน**

- ข้อความ rate-limit ทั้ง 4 ชิ้นแรก (task-breakdown, PRD, feature flow, api-contract) เกิดใน 2 วัน (06-10 ถึง 06-11) จากบัญชี net-lynx ซึ่งตรงกับช่วงที่แปลงผล grill เป็นเอกสาร
- ทั้ง 4 ชิ้นพูดถึง "ต้องมี" แต่ไม่มีชิ้นไหนตอบว่า "อยู่ชั้นไหน, key ด้วยอะไร, เก็บ state ที่ไหน" คำถามเหล่านี้ควรถูกยิงใน grill
- ชิ้นเดียวที่ระบุชั้น (`c53704dec`) เลือก FastAPI แสดงว่าตอนนั้นภาพในหัวคือ "ทำใน service" ไม่ใช่ edge

**ที่ grill อย่างเดียวอธิบายไม่ได้**

- **โค้ดมาก่อนการตัดสินใจ:** `287456a34` เพิ่ม limiter ใน BFF โดยไม่อ้าง spec และ PR review ตอนนั้นไม่ได้ถามว่าควรอยู่ตรงนี้ไหม
- **CR ต่อ ๆ มาไม่มีด่านตรวจชั้น:** CR-122/141/173/175 เขียนโดยหลายคน หลายเดือนหลัง grill แต่ผ่านการอนุมัติได้ทั้งที่ระบุชื่อคลาสในโค้ด

สรุปคือ grill เป็นจุดที่ถูกที่สุดที่จะจับได้ แต่ spec ไหลเพราะหลุดสามด่านต่อกัน: grill, PR review ของโค้ดแรก, และการอนุมัติ CR

**คำถามที่ยังเปิดอยู่**

- มีบันทึกหรือ transcript ของ grill ช่วง 06-10 ไหม ถ้ามีจะยืนยันได้ว่ามีคำถามเรื่องชั้นหรือไม่
- ตอนนั้นมี nginx อยู่ใน deployment แล้วหรือยัง ถ้ายังไม่มี การเลือกทำในแอปอาจเป็นทางเดียวในตอนนั้น ปัญหาจะกลายเป็น "ไม่กลับมาทบทวนเมื่อมี nginx" แทน

## บทเรียนและ action items

แต่ละข้อผูกกับด่านที่หลุด เพื่อให้เรื่อง cross-cutting ต่อไปไม่ไหลแบบเดิม

**ด่าน grill**

- [ ] เพิ่ม checklist ใน grill: ทุก NFR ด้าน security/การเข้าถึง ต้องตอบ 3 คำถาม: อยู่ชั้นไหน (edge/BFF/service), key ด้วยอะไร, state อยู่ที่ไหน
- [ ] เขียน ADR ว่าด้วย "สิ่งที่ทำที่ edge" (rate limit, realip, CORS, TLS, body size) ให้ CR ทุกฉบับอ้างถึง
- [ ] กฎที่ผูกกับตัวตน (ต่อเบอร์ ต่อ device) ต้องตอบใน grill ว่าทำไมต่อ IP ไม่พอ และจะเก็บ state ร่วมกันหลาย process ได้อย่างไร

**ด่านเขียน spec / CR**

- [ ] เพิ่มกฎใน skill `spec-authoring`: spec เขียนผลลัพธ์ที่ต้องการ ห้ามระบุชื่อคลาสหรือไฟล์ในโค้ด
- [ ] เมื่อเปิด issue เพื่อเปลี่ยนทิศทาง (แบบ #627) ให้ใส่หมายเหตุใน spec กลาง (`api-contract.md`) ทันที ไม่รอ CR
- [ ] CR ที่บันทึก as-built ต้องมีบรรทัดทบทวนว่าสิ่งที่มีอยู่ควรเป็นมาตรฐานหรือไม่

**ด่าน PR review**

- [ ] เพิ่มข้อใน skill `pr-code-review`: ถ้า PR เพิ่ม state แบบ in-memory ที่ต้องแชร์ระหว่าง request หรือทำเรื่อง cross-cutting ต้องอ้าง spec หรือ ADR ได้

## งานค้างจาก CR-188

โค้ด limiter ในแอปถูกลบหมดแล้วที่ HEAD `fee3fffa3` แต่ยังมีร่องรอยและการตรวจรับที่ค้างอยู่

- [ ] ลบ response 429 ใน OpenAPI ที่ไม่มี limiter แล้ว: `backend/apiapp/modules/evacuee/router.py:23`, `backend/apiapp/modules/external/router.py:61` แล้ว regenerate `fastapi.json` / `openapi.d.ts`
- [ ] แก้คอมเมนต์ `frontend/src/lib/server/fastapi.ts:16` และชื่อ test "rate-limits per user" ใน `fastapi.test.ts:20`
- [ ] ตรวจ AC-2 ถึง AC-7 ของ CR-188 (ยังไม่ได้ติ๊ก แต่โค้ดถูกลบไปแล้ว)
- [ ] ยืนยันว่าตั้ง `realip` (CR-188 FR-1) บน staging/prod แล้ว ถ้ายัง nginx ก็จะเห็น IP เดียวกันทุกคนเหมือนเดิม
- [ ] ตัดสินใจว่าค่า 10000 r/min + burst 2000 คือค่าถาวรหรือแค่ชั่วคราว (ค่านี้แทบไม่จำกัดอะไร)
- [ ] `StaffPinThrottle` ยังเป็น in-memory ในแอปตามขอบเขต CR-188 ต้องตรวจว่ามีปัญหา multi-process เดียวกันหรือไม่

ถ้าจะแก้ spec จากข้อเหล่านี้ ต้องตัดสินใจก่อนว่าจะ track ด้วยวิธีไหน ตาม `docs/change-management.md`

## ภาคผนวก: ตำแหน่ง spec ที่เกี่ยวข้อง

| เอกสาร | ชั้นที่สั่ง | commit แรก | สถานะตอนนี้ |
| --- | --- | --- | --- |
| `docs/prd/phase-r2-foundation.md:208, 272` (NFR-15) | ไม่ระบุ | `b172e068d` | ยังอยู่ |
| `docs/prd/phase-r4-integration-handover.md:206` (NFR-24) | ไม่ระบุ | `b172e068d` | ยังอยู่ |
| `docs/task-breakdown/04-donation.md:84, 86` | ไม่ระบุ ("ที่มีอยู่แล้ว") | `236a6b957` | ยังอยู่ |
| `docs/task-breakdown/10-eoc.md:26, 52` | per-key | `cebd0925e` | ยังอยู่ |
| `docs/data/api-contract.md:140` | ไม่ระบุ | `3ffc193fa` | แก้เป็น nginx zones แล้ว (CR-188) |
| `docs/features/public-tier-flow-spec.html:34, 52, 96` | ไม่ระบุ | `3ffc193fa` | ยังอยู่ |
| `docs/sitemap.md:151–176` | ไม่ระบุ | `30aa2d053` | ยังอยู่ |
| `smart-shelter-data-model.md` | FastAPI | `c53704dec` | ลบไฟล์แล้ว (`bff5d967c`) |
| CR-044:29 | BFF | `30211019f` | ถูก CR-188 supersede |
| CR-080:140 | BFF + FastAPI | `46d4b890a` | ถูก CR-188 supersede |
| CR-092:558 | ไม่ระบุ (ต่อ IP และต่อเบอร์) | `2708a22bb` | ถูก CR-188 supersede |
| CR-096:76 | ไม่ระบุ | `68e5f36f6` | ถูก CR-188 supersede |
| CR-122:66 | BFF (คลาสที่มีอยู่) | `e476553e0` | ถูก CR-188 supersede |
| CR-141:113 | แอป in-memory | `56aef4e77` | ถูก CR-188 supersede |
| CR-151:497, CR-163:77 | ไม่ระบุ (ต่อ device) | `335bd3f88` (CR-163) | ถูก CR-188 supersede |
| CR-173:18, 44 | BFF | `a316d2e9d` | ถูก CR-188 supersede |
| CR-175:54 | BFF | `e39e3abb1` | ถูก CR-188 supersede |
| CR-169:256, CR-181:74 | nginx | `5fa4f4677`, `2564371df` | ตรงทิศใหม่ |
| CR-188 | nginx | `b95cdb27e` | อนุมัติ 2026-10-23 |

**ความน่าเชื่อถือของข้อมูล**

- **ยืนยันแล้ว:** hash, วันที่, ผู้เขียน และ subject ของ commit ทั้งหมด (จาก `git log -S` และ `git show`) และสุ่มตรวจซ้ำ 6 commit หลัก
- **อนุมาน:** บัญชี net-lynx คือ owner, เหตุผลที่เลือก in-memory Map (ไม่พบเหตุผลใน spec)
- **ยังไม่ได้ตรวจ:** ผู้เขียนและสถานะ merge ของ PR #18, config nginx บน host, ตัวเลข incident ใน CR-188
