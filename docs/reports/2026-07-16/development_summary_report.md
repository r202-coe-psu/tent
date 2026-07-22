# รายงานสรุปสถานะการพัฒนาซอฟต์แวร์ (Software Development Summary Report)

รายงานฉบับนี้แยกแยะสถานะงานทั้งหมดตามความก้าวหน้าในการเขียนโค้ดและทดสอบจริงในโปรแกรม โดยอ้างอิงข้อมูลล่าสุุด ณ วันที่ **16 กรกฎาคม 2026**

---

## 🟢 1. งานที่พัฒนาเสร็จสิ้นแล้ว / อยู่ระหว่าง QA (Done & QA Ready — ความคืบหน้า ≥90%)
งานในกลุ่มนี้เขียนโค้ดหลักเสร็จสมบูรณ์ 100% แล้ว ผ่านการทดสอบระดับ Unit tests และ BFF endpoints ปัจจุบันอยู่ในกระบวนการรอทดสอบระบบ หรือตรวจรับอย่างเป็นทางการ (Ready for Testing) มีจำนวน **26 งาน**:

| รหัสงาน | ชื่อฟีเจอร์ / งานหลัก | ความคืบหน้า | รายละเอียดสถานะย่อย | โมดูลที่เกี่ยวข้อง |
| :---: | :--- | :---: | :--- | :--- |
| **T-06** | Household search + household check-in/out | `90.0%` | Status: Ready for Testing / QA Ready | 02-people |
| **T-07** | Pet / asset / vehicle records | `90.0%` | 0 Done, 1 QA Ready, 0 In Progress, 0 Not Started | 02-people |
| **T-08** | Zone definition + capacity | `90.0%` | 0 Done, 3 QA Ready, 0 In Progress, 0 Not Started | 02-people |
| **T-09** | Zone allocation + suggest (warning-only) | `90.0%` | 0 Done, 1 QA Ready, 0 In Progress, 0 Not Started | 02-people |
| **T-11** | Stock receive + ledger write | `90.0%` | 0 Done, 5 QA Ready, 0 In Progress, 0 Not Started | 03-C |
| **T-12** | Stock distribute (outbound)destinationST-8: ทดลองใช้งานจริงและตรวจสอบความสมบูรณ์ (Manual Demo & Verification) | `100.0%` | 8 Done, 0 QA Ready, 0 In Progress, 0 Not Started | 03-C |
| **T-13** | Inter-shelter transfer + receive confirm | `90.0%` | Status: Ready for Testing / QA Ready | 03-C |
| **T-15** | Donor pre-declaration | `90.0%` | 0 Done, 1 QA Ready, 0 In Progress, 0 Not Started | 04-donation |
| **T-17** | Groundwork: kitchen schema + Inventory linkage spike | `90.0%` | Status: Ready for Testing / QA Ready | 05-D |
| **T-25** | Meal plan from occupancy x SOP ratio | `90.0%` | Status: Ready for Testing / QA Ready | 05-D |
| **T-26** | Kitchen requisition (deduct stock) | `90.0%` | Status: Ready for Testing / QA Ready | 05-D |
| **T-27** | Meal service record | `90.0%` | Status: Ready for Testing / QA Ready | 05-D |
| **T-47** | Shelter master + config + seed data | `90.0%` | 0 Done, 4 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-48** | Person registration + edit profile | `90.0%` | 0 Done, 4 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-49** | Screening: vulnerability flags / medical notes / fast-track | `90.0%` | 0 Done, 2 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-50** | Person Shelter ID/QR generation | `90.0%` | 0 Done, 2 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-51** | Search + QR scan check-in/out + movement history | `90.0%` | 0 Done, 2 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-52** | Dashboard v1 | `90.0%` | Status: Ready for Testing / QA Ready | 00-baseline |
| **T-57** | Public Portal landing + real-time metrics panel | `90.0%` | Status: Ready for Testing / QA Ready | 12-public |
| **T-58** | Public Shelter Dashboard (/shelters) | `90.0%` | Status: Ready for Testing / QA Ready | 12-public |
| **T-60** | Public donation & queue booking (/donate) | `90.0%` | 0 Done, 6 QA Ready, 0 In Progress, 0 Not Started | 04-donation |
| **T-61** | Master config ข้อมูลบุคคลและการลงทะเบียน (Demographic & Registration) | `95.0%` | 1 Done, 1 QA Ready, 0 In Progress, 0 Not Started | 00-baseline |
| **T-62** | Back Office User Management | `90.0%` | Status: Ready for Testing / QA Ready | 00-baseline |
| **T-63** | Master config Shelter  && Household field | `90.0%` | Status: Ready for Testing / QA Ready | 00-baseline |
| **T-64** | Export shelter data excel | `90.0%` | Status: Ready for Testing / QA Ready | 00-baseline |
| **T-65** | Thailand master data config data | `90.0%` | Status: Ready for Testing / QA Ready | 00-baseline |

---

## 🟡 2. งานที่อยู่ระหว่างการพัฒนา (In Progress — ความคืบหน้า 10% ถึง 89%)
งานในกลุ่มนี้มีโครงสร้างไฟล์และโค้ดฟังก์ชันหลักแล้วบางส่วน อยู่ระหว่างพัฒนาหน้าจอ UI, เชื่อมต่อ API หรือทวนสอบความเสถียรของฟังก์ชันขั้นสูง มีจำนวน **15 งาน**:

| รหัสงาน | ชื่อฟีเจอร์ / งานหลัก | ความคืบหน้า | รายละเอียดสถานะย่อย | โมดูลที่เกี่ยวข้อง |
| :---: | :--- | :---: | :--- | :--- |
| **T-01** | RBAC extension: new roles + field-level permissions | `50.0%` | Status: In Progress / Developing | 01-core |
| **T-02** | Data-model expansion (remote-first Central→Edge; deny PouchDB) | `50.0%` | Status: In Progress / Developing | 01-core |
| **T-03** | Shared API convention + contract freeze | `50.0%` | Status: In Progress / Developing | 01-core |
| **T-04** | Household create + attach members + head | `67.5%` | 0 Done, 6 QA Ready, 0 In Progress, 2 Not Started | 02-people |
| **T-10** | Supply Item catalog (master) | `50.0%` | 0 Done, 0 QA Ready, 4 In Progress, 0 Not Started | 03-C |
| **T-14** | Stock dashboard + reorder threshold | `50.0%` | Status: In Progress / Developing | 03-C |
| **T-16** | Donation intake audit trail | `16.7%` | 0 Done, 0 QA Ready, 1 In Progress, 2 Not Started | 04-donation |
| **T-18** | Groundwork: SOP ratio data gathering + volunteer schema | `75.0%` | 0 Done, 5 QA Ready, 0 In Progress, 1 Not Started | 07-B |
| **T-21** | Donation reservation | `50.0%` | 0 Done, 0 QA Ready, 3 In Progress, 0 Not Started | 04-donation |
| **T-22** | Donation cut-off | `53.3%` | 0 Done, 3 QA Ready, 1 In Progress, 2 Not Started | 04-donation |
| **T-30** | SOP ratio configuration | `86.0%` | 0 Done, 9 QA Ready, 1 In Progress, 0 Not Started | 07-B |
| **T-31** | Daily resource calculation engine | `89.0%` | 3 Done, 6 QA Ready, 1 In Progress, 0 Not Started | 07-B |
| **T-34** | Referral & hand-off | `44.4%` | 0 Done, 0 QA Ready, 8 In Progress, 1 Not Started | 09-F |
| **T-54** | Remote-first write + Central→Edge failover (deny PouchDB/offline draft) | `50.0%` | Status: In Progress / Developing | 00-baseline |
| **T-59** | Public FAQ (dynamic) + EOC FAQ setup screen | `50.0%` | Status: In Progress / Developing | 12-public |

---

## 🔴 3. งานที่ยังไม่ได้เริ่มพัฒนา / หยุดชั่วคราว (Not Started & Paused — ความคืบหน้า <10%)
งานในกลุ่มนี้ยังไม่มีไฟล์ซอร์สโค้ดในโครงสร้างระบบ (หรือยังไม่มีผลลัพธ์ย่อยเนื่องจากติด Dependency หรืองานถูกเลื่อนไปเฟสอื่น) มีจำนวน **27 งาน**:

| รหัสงาน | ชื่อฟีเจอร์ / งานหลัก | สถานะ | น้ำหนัก (Adj MD) | โมดูลที่เกี่ยวข้อง |
| :---: | :--- | :---: | :---: | :--- |
| **Q-01** | Q-01 — Deployment + release automation | Not Started | 5.0 MD | 01-core |
| **Q-02** | Q-02 — Post-launch support / warranty buffer | Not Started | 15.5 MD | 01-core |
| **Q-03** | Q-03 — User manual + ops runbook | Not Started | 7.5 MD | 01-core |
| **T-05** | Household Shelter ID/QR generation | Pause | 2.5 MD | 02-people |
| **T-19** | Groundwork: shelter_report_case schema + case↔referral handoff | Not Started | 5.0 MD | 08-E |
| **T-20** | R2 integration + Backoffice Foundation Gate UAT | Not Started | 4.0 MD | 01-core |
| **T-23** | Smart redirect to under-threshold shelters | Pause | 3.5 MD | 04-donation |
| **T-24** | Donation transparency report | Pause | 4.0 MD | 04-donation |
| **T-25 ,T-29** | .11 — Exit Criteria publish | Not Started | - | Other / Config |
| **T-28** | Volunteer registration + skills + availability | Pause | 3.0 MD | 06-A |
| **T-29** | Skill match + task/shift assignment | Pause | 4.5 MD | 06-A |
| **T-32** | Resource calculation dashboard | In Progress / Developing | 3.0 MD | 07-B |
| **T-33** | Shelter report case intake + list/detail + escalate | Not Started | 4.0 MD | 08-E |
| **T-35** | Resource-calc backbone + read-model perf | Not Started | 5.0 MD | 01-core |
| **T-36** | R3 integration + Operations Gate UAT | Not Started | 4.5 MD | 01-core |
| **T-37** | EOC cross-shelter aggregate data API | Not Started | 5.0 MD | 10-eoc |
| **T-38** | EOC API scope rules + API-key principal | Not Started | 3.0 MD | 10-eoc |
| **T-39** | Open API: aggregate, auth, rate-limit, versioned | Not Started | 5.5 MD | 10-eoc |
| **T-40** | Search consent / opt-out | Not Started | 2.5 MD | 11-famsearch |
| **T-41** | Privacy-preserving public family search + anti-enumeration | Not Started | 6.5 MD | 11-famsearch |
| **T-42** | SOP what-if simulation | Not Started | 4.5 MD | 07-B |
| **T-43** | RoPA / consent / retention finalization | Not Started | 5.5 MD | 00-baseline |
| **T-44** | Cross-module UAT + production hardening + handover package | Not Started | 9.0 MD | 01-core |
| **T-45** | Donation/kitchen/inventory polish + UAT support | Pause | 4.0 MD | 03-C |
| **T-46** | Final Handover Gate sign-off + training delivery | Not Started | 4.5 MD | 01-core |
| **T-53** | Export + audit log + masking | Not Started | 4.0 MD | 00-baseline |
| **T-55** | Manual/Excel fallback + assisted import | Not Started | 4.0 MD | 00-baseline |
