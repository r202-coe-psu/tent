# Developer Walkthrough Script

วันที่จัดทำ: 2026-06-17  
ผู้ใช้เอกสาร: Project Owner, Product Owner, Student Lead, Developer Team  
วัตถุประสงค์: ใช้เป็น script สำหรับ walkthrough ทีม developer และเป็น reference สำหรับการทำงานร่วมกัน การ tracking change การเขียนรายงาน และการทำ versioning

---

## 1. Opening

สวัสดีทุกคนครับ วันนี้เราจะ walkthrough ภาพรวมการทำงานของโปรเจกต์นี้ร่วมกัน โดย session นี้ไม่ได้เน้นแค่การอธิบายว่าแต่ละคนต้องทำ feature อะไร แต่จะเน้นให้ทุกคนเข้าใจวิธีคิด วิธีทำงานร่วมกัน และมาตรฐานที่เราจะใช้ตลอดทั้งโปรเจกต์

เป้าหมายหลักของ walkthrough วันนี้คือทำให้ทีมเข้าใจตรงกันใน 5 เรื่องสำคัญ

1. Convention การเขียนงานและการจัดโครงสร้างงาน
2. วิธีคิดเกี่ยวกับ database และหลักการออกแบบ database
3. วิธีจัดการ spec ที่ไม่ชัดเจนหรือเปลี่ยนแปลง
4. วิธีถามปัญหาและ escalation path ระหว่าง Developer, Student Lead, Project Owner และ Product Owner
5. หลักการ YAGNI, DRY และวิธี tracking change เพื่อให้เขียนรายงาน ทำ versioning และตรวจสอบย้อนหลังได้อย่างแม่นยำ

ขอให้ทุกคนมองว่าเอกสารและ process เหล่านี้ไม่ได้มีไว้เพื่อเพิ่มขั้นตอนให้ช้า แต่มีไว้เพื่อป้องกันปัญหาที่มักเกิดในโปรเจกต์ที่มีหลายคนทำงานพร้อมกัน เช่น ทำ feature ไม่ตรง spec, แก้ database แล้วทีมอื่นไม่รู้, UI เปลี่ยนแล้ว flow ไม่ตรงกับ product decision หรือเขียนรายงานย้อนหลังไม่ได้ว่าเปลี่ยนอะไรไปบ้าง

หลังจบ session นี้ สิ่งที่อยากให้ทุกคนทำได้คือรู้ว่าเวลาจะเริ่มงานหนึ่งชิ้นต้องดูอะไรบ้าง เวลาติดปัญหาต้องถามใคร และเวลามีการเปลี่ยนแปลงต้องแจ้งอย่างไรให้ track ได้ครบ

---

## 2. Working Mindset

ก่อนลงรายละเอียด ผมอยากให้ทุกคนยึด mindset เดียวกันก่อน

โปรเจกต์นี้ไม่ได้วัดแค่ว่า feature เสร็จหรือไม่เสร็จ แต่เราจะให้ความสำคัญกับความถูกต้อง ความสอดคล้องกับ spec ความเข้าใจร่วมกันของทีม และความสามารถในการตามรอยการเปลี่ยนแปลงย้อนหลัง

ทุกครั้งที่ทำงาน ขอให้ถามตัวเองเสมอว่า

- สิ่งที่กำลังทำตรงกับ spec หรือไม่
- สิ่งที่กำลังทำกระทบ database หรือ feature อื่นหรือไม่
- มีการเปลี่ยนแปลงจาก requirement เดิมหรือไม่
- มีใครควรรู้เรื่องนี้ก่อน merge หรือก่อนส่งงานหรือไม่
- ถ้าต้องเขียนรายงานย้อนหลัง เราจะอธิบายได้ไหมว่าเปลี่ยนอะไร เพราะอะไร และกระทบอะไร

ถ้างานหนึ่งทำเสร็จแต่ไม่มี record ว่าเปลี่ยนอะไร ทำไมถึงเปลี่ยน หรือกระทบส่วนไหนบ้าง งานนั้นอาจเสร็จในเชิง coding แต่ยังไม่เสร็จในเชิง project process

หลักที่อยากให้จำไว้คือ:

```text
Code ที่ดีต้องทำงานได้
Database ที่ดีต้องรักษาความถูกต้องของข้อมูล
Process ที่ดีต้องทำให้ทีมตามรอยการเปลี่ยนแปลงได้
```

---

## 3. Team Roles And Escalation Path

ต่อไปเราจะตกลง role และลำดับการถามปัญหาให้ชัดเจน

ในโปรเจกต์นี้เราจะมี role หลัก ๆ คือ Developer, Student Lead, Sponsor, Project Owner และ Product Owner

Developer มีหน้าที่ implement feature ตาม spec, ตรวจสอบความถูกต้องของงานตัวเอง, แจ้งปัญหาที่พบ และไม่ตัดสินใจเปลี่ยน requirement สำคัญเองโดยไม่มีการแจ้ง

Student Lead มีหน้าที่ช่วยดู technical direction, ช่วย unblock ปัญหาทางเทคนิค, review approach ของ developer และช่วยประเมินว่าวิธีแก้ปัญหาด้านเทคนิคเหมาะสมหรือไม่

Project Owner มีหน้าที่ดูภาพรวมของ project decision, spec, scope, timeline, change tracking และการตัดสินใจเมื่อมีผลกระทบต่อ requirement หรือโครงสร้างหลักของระบบ

Product Owner มีหน้าที่ดู product direction, user flow, usability, wording, behavior ของ product และการตัดสินใจที่กระทบประสบการณ์ผู้ใช้

ลำดับการถามปัญหาให้ใช้หลักนี้

```text
ถ้าเป็นปัญหาเรื่อง spec หรือ requirement:
Developer -> Project Owner

ถ้าเป็นปัญหาด้านเทคนิค:
Developer -> Student Lead -> Project Owner ถ้าติดจริง ๆ หรือกระทบ scope/spec/CouchDB data model

ถ้าเป็นปัญหาเรื่อง UI หรือ product flow:
Developer -> Product Owner หรือ Project Owner

ถ้าเป็นการเปลี่ยน CouchDB schema/data model:
Developer -> Student Lead review technical approach -> แจ้ง Project Owner ทุกครั้ง
```

ขอให้ทุกคนแยกให้ออกว่าปัญหาที่เจอเป็นปัญหาแบบไหน

ถ้าคำถามคือ "ระบบควรทำอะไร" หรือ "business rule ควรเป็นอย่างไร" ให้ถาม Project Owner

ถ้าคำถามคือ "จะ implement อย่างไร" หรือ "code/query/API ควรวางอย่างไร" ให้ถาม Student Lead ก่อน

ถ้าคำถามคือ "ผู้ใช้ควรเห็นอะไร กดอะไร หรือ flow ควรเป็นแบบไหน" ให้ถาม Product Owner หรือ Project Owner

---

## 4. Convention การทำงาน

Convention คือข้อตกลงร่วมกันว่าจะเขียนงาน จัดโครงสร้าง และสื่อสารอย่างไรให้ทีมทำงานต่อกันได้ง่าย

เมื่อมีหลายคนทำงานใน codebase เดียวกัน ถ้าแต่ละคนใช้ naming, structure และ style คนละแบบ จะทำให้ code อ่านยาก review ยาก debug ยาก และแก้ต่อยากมาก ดังนั้นก่อนเพิ่มงานใหม่ ให้ดู pattern เดิมของโปรเจกต์ก่อนเสมอ

### 4.1 Naming Convention

สำหรับ frontend ให้ถือ `frontend/CONVENTIONS.md` เป็น source of truth ของ naming convention ถ้าใน walkthrough script นี้มีจุดใดที่ไม่ละเอียดพอหรือดูขัดกับ `frontend/CONVENTIONS.md` ให้ยึด `frontend/CONVENTIONS.md` เป็นหลัก

การตั้งชื่อใน frontend ต้องสื่อความหมายชัดเจน และต้องใช้ case ให้ตรงกับชนิดของสิ่งที่เรากำลังตั้งชื่อ

หลักสำคัญคือ:

```text
Frontend variables/functions: camelCase
Types/interfaces/classes: PascalCase
Enum-like constants: SCREAMING_SNAKE + as const
Files/directories: follow frontend/CONVENTIONS.md file naming rules
Database/schema names: follow database convention ของโปรเจกต์
```

สิ่งที่ต้องหลีกเลี่ยงคือชื่อที่กว้างเกินไปหรือไม่บอก purpose เช่น

```text
data
temp
test
item
value
x
abc
```

ชื่อที่ดีควรบอกว่าเป็นข้อมูลอะไร ใช้ทำอะไร หรืออยู่ใน context ไหน เช่น

```text
userProfile
shelterCode
evacueeStatus
movementEvent
stockLedgerEntry
availableRooms
createdAt
updatedAt
```

จาก `frontend/CONVENTIONS.md` ให้ใช้ naming pattern ต่อไปนี้ใน frontend:

```text
Local variables / parameters:
- camelCase
- ตัวอย่าง: shelterId, formData, checkedIn, availableRooms

Boolean variables:
- camelCase และควรขึ้นต้นด้วย is/has/can/should เมื่อช่วยให้อ่านชัดขึ้น
- ตัวอย่าง: isLoading, isError, hasPermission, canSubmit, shouldReset

Functions:
- camelCase และควรเป็น verb phrase
- ตัวอย่าง: createOccupant, countCheckedIn, parseDoc, deriveQuantities

Event handlers ใน parent component:
- camelCase และใช้ handle* เมื่อเป็น handler ภายใน component
- ตัวอย่าง: handleSave, handleCheckOut, handleSubmit

Callback props:
- camelCase และใช้ on* สำหรับ callback ที่ส่งเข้า component
- ตัวอย่าง: onSave, onCheckOut, onCancel

Factory functions:
- ใช้ create* หรือ make*
- ตัวอย่าง: createOccupant, makeShelterConfig

Type guards:
- ใช้ is*
- ตัวอย่าง: isOccupant, isShelterConfig

Query / mutation hooks:
- ใช้ use*
- ตัวอย่าง: useOccupants, useCheckIn

Type / Interface:
- PascalCase
- ตัวอย่าง: ShelterConfig, OccupantInput, Occupant

Zod schema:
- camelCase + Schema suffix
- ตัวอย่าง: occupantInputSchema

Inferred Zod type:
- PascalCase และใช้ stem เดียวกับ schema
- ตัวอย่าง: OccupantInput

Enum-like const:
- SCREAMING_SNAKE + as const
- ตัวอย่าง: SHELTER_IDS

Query key factory:
- camelCase + Keys suffix
- ตัวอย่าง: shelterKeys

Repository interface:
- PascalCase + Repository suffix
- ตัวอย่าง: ShelterRepository

Concrete PouchDB implementation:
- PascalCase + PouchRepository suffix
- ตัวอย่าง: ShelterPouchRepository
```

ตัวอย่างคำพูดตอน walkthrough:

```text
ใน frontend เราจะไม่ตั้งชื่อตัวแปรแบบ random หรือใช้ชื่อกลาง ๆ อย่าง data, temp, value ถ้า context ไม่ชัด

ตัวแปรและ function ใช้ camelCase เช่น shelterId, formData, createOccupant

Type และ interface ใช้ PascalCase เช่น OccupantInput, ShelterRepository

ถ้าเป็น callback prop ให้ใช้ on* เช่น onSave และถ้าเป็น handler ภายใน component ให้ใช้ handle* เช่น handleSave

ถ้าเป็น Zod schema ให้ลงท้ายด้วย Schema เช่น occupantInputSchema และ inferred type ให้เป็น PascalCase stem เดียวกัน เช่น OccupantInput
```

สำหรับ CouchDB documents ให้ใช้ lower_snake ตาม `docs/data/schema.md` เช่น

```text
evacuee
stock_ledger
created_at
updated_at
shelter_code
evacuee_id
household_id
current_stay
screened_at
occurred_at
tracking_token_hash
```

สิ่งที่ควรหลีกเลี่ยงคือการใช้หลาย style ปนกันโดยไม่มีเหตุผล เช่น `userId`, `user_id`, `userid` อยู่ใน layer เดียวกัน เพราะจะทำให้ query, mapping และ documentation สับสน

สำหรับ frontend TypeScript ให้ใช้ camelCase เป็นหลัก แต่ถ้าต้อง map กับ external data หรือ database field ที่มีชื่อเฉพาะ เช่น `_id`, `_rev`, หรือ field จาก API ให้แยก boundary ให้ชัด และอย่ากระจาย naming style ที่ต่างกันไปทั่ว codebase

### 4.2 File And Folder Structure

เวลาเพิ่ม feature ใหม่ ให้ดูโครงสร้างเดิมของโปรเจกต์ก่อนเสมอ ถ้าโปรเจกต์มี pattern อยู่แล้ว ให้ตาม pattern เดิม

สำหรับ frontend ให้ใช้ file และ directory naming ตาม `frontend/CONVENTIONS.md`:

```text
Svelte component:
- kebab-case.svelte
- ตัวอย่าง: intake-form.svelte

TypeScript module ทั่วไป:
- kebab-case.ts
- ตัวอย่าง: shelter-sync.ts

TypeScript module ที่มี layer qualifier:
- <name>.<qualifier>.ts
- ตัวอย่าง: shelter.repository.ts, shelter.pouch.ts, shelter.seed.ts

Test file:
- <module>.test.ts และ colocated กับไฟล์ที่ test
- ตัวอย่าง: shelter.test.ts

Feature root:
- singular kebab-case noun
- ตัวอย่าง: features/shelter/

Layer subdirectory:
- singular noun
- ตัวอย่าง: domain/, data/, application/, ui/

Feature barrel:
- index.ts
- ตัวอย่าง: features/shelter/index.ts

Route directory:
- ใช้ SvelteKit conventions เช่น [param] และ (group)
- ตัวอย่าง: routes/(protected)/shelter/

shadcn-svelte component files:
- <component>.svelte + index.ts
- ตัวอย่าง: button/button.svelte
```

ตัวอย่างหลักคิด:

- ถ้า feature เดิมแยก component, service, API และ validation ไว้แบบใด feature ใหม่ควรเดินตามแนวนั้น
- ถ้ามี folder สำหรับ shared utilities อยู่แล้ว ไม่ควรสร้าง helper กระจัดกระจายหลายที่
- ถ้ามี convention สำหรับ route, controller, model หรือ schema อยู่แล้ว ให้ใช้ convention เดิม
- อย่าสร้าง abstraction ใหม่ถ้ายังไม่มีความจำเป็นจริง

ก่อนสร้าง structure ใหม่ ให้ถามตัวเองว่า:

```text
ช่วยลดความซ้ำจริงไหม
ทำให้ code อ่านง่ายขึ้นไหม
มี feature อื่นต้องใช้ร่วมไหม
เข้ากับ pattern เดิมของโปรเจกต์ไหม
```

ถ้าคำตอบยังไม่ชัด ให้ปรึกษา Student Lead ก่อน

### 4.3 Engineering Principles: YAGNI And DRY

นอกจาก convention เรื่องชื่อไฟล์ โครงสร้าง และ commit แล้ว ขอให้ทุกคนใช้หลักการ YAGNI และ DRY เป็นหลักคิดเวลาตัดสินใจออกแบบ code, database และ UI

หลักการสองอย่างนี้ช่วยให้ระบบไม่ซับซ้อนเกินจำเป็น และช่วยลดงานซ้ำที่ทำให้ bug เกิดซ้ำหลายจุด

#### YAGNI: You Aren't Gonna Need It

YAGNI แปลตรงตัวคือ "คุณยังไม่ได้ต้องใช้มัน"

หลักการคืออย่าสร้าง feature, abstraction, doc type, field, design doc, view, config หรือ flow เผื่ออนาคต ถ้ายังไม่มี requirement จริง หรือยังไม่มีเหตุผลชัดเจนว่าต้องใช้ตอนนี้

ตัวอย่างสิ่งที่ควรหลีกเลี่ยง:

```text
เพิ่ม field เผื่อไว้ก่อนโดยยังไม่มี spec ใช้
สร้าง doc type สำหรับ feature ที่ยังไม่ได้อยู่ใน scope
เพิ่ม CouchDB view เผื่อ report ที่ยังไม่ถูกต้องการ
ทำ role permission ซับซ้อน ทั้งที่ตอนนี้มี user type เดียว
สร้าง service layer หลายชั้น ทั้งที่ logic ยังเรียบง่าย
เพิ่ม setting/config จำนวนมากโดยยังไม่มี use case
ทำ UI state เผื่อหลาย flow ทั้งที่ product ยังไม่ตัดสินใจ
```

เหตุผลคือสิ่งที่ทำเผื่อไว้มักกลายเป็นภาระของทีมในอนาคต เพราะต้อง maintain, test, document และอธิบายในการ review ทั้งที่อาจไม่ได้ถูกใช้จริง

YAGNI ไม่ได้แปลว่าออกแบบแบบไม่คิดอนาคต แต่หมายถึงให้แยกให้ออกระหว่าง "ออกแบบให้ต่อยอดได้" กับ "สร้างของที่ยังไม่จำเป็น"

ตัวอย่างการใช้ YAGNI ที่เหมาะสม:

```text
ถ้า schema ต้องการ donation status แค่ declared, received, expired, cancelled
ให้เริ่มจาก status set นี้ก่อน
อย่าเพิ่ม archived, disputed, refunded ถ้ายังไม่มี flow รองรับ
```

สำหรับ database ให้ระวังเป็นพิเศษ เพราะ field, doc type, view หรือ index ที่เพิ่มเข้ามาโดยไม่จำเป็นจะกลายเป็น technical debt ทันที

ก่อนเพิ่ม schema เพื่อเผื่ออนาคต ให้ถามตัวเองว่า:

```text
มี requirement จริงตอนนี้ไหม
มี feature ที่จะใช้ข้อมูลนี้จริงไหม
มีคนรับผิดชอบ business meaning ของ field นี้ไหม
ถ้าไม่เพิ่มตอนนี้ ระบบยังทำงานตาม spec ได้ไหม
```

ถ้าคำตอบคือยังไม่มี requirement ชัดเจน ให้ยังไม่เพิ่ม และบันทึกเป็น future consideration แทน

#### DRY: Don't Repeat Yourself

DRY แปลว่าอย่าทำความรู้หรือ logic เดิมซ้ำหลายที่โดยไม่จำเป็น

หลักการคือถ้า business rule, validation, mapping, constant หรือ query logic เดียวกันถูกเขียนซ้ำหลายจุด เวลาต้องแก้ในอนาคตมีโอกาสสูงมากที่จะแก้ไม่ครบ แล้วเกิด bug ที่ behavior ไม่ตรงกัน

ตัวอย่าง duplication ที่ควรระวัง:

```text
validation rule เดียวกันเขียนซ้ำทั้ง frontend และ backend โดยไม่มี shared definition หรือ documentation
donation status หรือ current_stay.status string ถูก hardcode หลายไฟล์
permission check logic เขียนซ้ำหลาย endpoint
date formatting logic เขียนซ้ำในหลาย component
CouchDB Mango selector หรือ query condition เดียวกัน copy ไปหลาย query
API response mapping ซ้ำหลาย service
```

ถ้าเจอ logic ซ้ำที่เป็น business rule สำคัญ ให้พิจารณาดึงออกมาเป็น helper, constant, shared schema, service function หรือ utility ตาม pattern ของโปรเจกต์

ตัวอย่าง:

```text
แทนที่จะ hardcode status string หลายที่:

registered
checked_in
checked_out
transferred

ให้รวมไว้ใน source เดียว เช่น constants หรือ enum ที่ทีมใช้ร่วมกัน
```

อย่างไรก็ตาม DRY ต้องใช้ด้วย judgment ไม่ใช่เห็น code คล้ายกันนิดเดียวแล้วรีบ abstraction ทันที

บางครั้ง code ที่คล้ายกันอาจมี business meaning คนละอย่าง ถ้าดึงรวมเร็วเกินไป จะทำให้ future change ยากกว่าเดิม

หลักที่ควรใช้คือ:

```text
ซ้ำครั้งแรก: ยังไม่ต้องรีบ abstract
ซ้ำครั้งที่สอง: เริ่มสังเกต pattern
ซ้ำครั้งที่สามและมี meaning เดียวกัน: พิจารณาดึง common logic
```

DRY ที่ดีต้องทำให้ code อ่านง่ายขึ้นและลด bug จริง ไม่ใช่ทำให้ code ซับซ้อนขึ้นเพื่อให้ดูเหมือน reuse ได้

ถ้าไม่แน่ใจว่าควร abstract หรือยัง ให้ถาม Student Lead ก่อน

#### Balance Between YAGNI And DRY

YAGNI และ DRY ต้องใช้คู่กัน

YAGNI ช่วยเตือนว่าอย่าสร้างของที่ยังไม่จำเป็น

DRY ช่วยเตือนว่าอย่าปล่อยให้ logic สำคัญซ้ำหลายที่จนแก้ยาก

ตัวอย่างการ balance:

```text
ถ้า logic ยังใช้ที่เดียวและ requirement ยังไม่นิ่ง:
ให้เขียนตรง ๆ อ่านง่ายก่อน

ถ้า logic เดียวกันเริ่มถูกใช้หลายที่และ behavior ต้องเหมือนกัน:
ให้ดึงเป็น shared helper หรือ shared rule

ถ้ากำลังจะสร้าง abstraction เผื่ออนาคตแต่ยังไม่มี use case:
ให้หยุดก่อน และใช้ YAGNI ตรวจ decision
```

หลักสุดท้ายคือ abstraction ต้องเกิดจากปัญหาจริง ไม่ใช่จากการคาดการณ์ล่วงหน้าที่ไม่มี requirement รองรับ

### 4.4 Commit Convention

Commit message ต้องบอกได้ว่าเปลี่ยนอะไร ไม่ควรใช้ข้อความกว้าง ๆ เช่น

```text
fix
update
done
final
change
test
```

ตัวอย่าง commit message ที่ดี:

```text
feat(shelter): add evacuee intake form
fix(sync): stop double replication when switching remotes
refactor(db): extract movement snapshot repair helper
docs(data): update screening doc type notes
db(couch): add screening needs_referral field
test(domain): add validation tests for evacuee input
```

หนึ่ง commit ควรมี scope ที่ชัดเจน ไม่ควรรวมหลายเรื่องที่ไม่เกี่ยวกันไว้ใน commit เดียว เพราะจะทำให้ review ยากและย้อน version ยาก

ถ้ามี CouchDB schema, design doc, provisioning, validation หรือ spec-related change ควรระบุใน commit หรือ PR description ให้ชัดเจน

---

## 5. CouchDB/PouchDB Database Concept

ส่วนต่อไปเป็นเรื่องสำคัญมาก คือ database ของโปรเจกต์นี้

ระบบนี้ไม่ได้ใช้ relational database เป็นฐานหลัก แต่ใช้ **CouchDB/PouchDB แบบ offline-first**

ดังนั้นเวลาเราพูดถึง database ในโปรเจกต์นี้ ให้คิดเป็น:

```text
Database -> document database
Table -> database หรือ doc type แล้วแต่ context
Row -> document
Column -> field
Primary key -> _id
Foreign key -> reference id เช่น evacuee_id, item_id, household_id
Migration -> schema version, document transform, design doc/provisioning update
Aggregate table -> CouchDB view หรือ computed read model
```

เอกสารอ้างอิงหลักมี 2 ไฟล์:

```text
docs/data/data-model.md
- ใช้เป็น canonical สำหรับ topology, database policy, sync, conflict, security, validation และ retention

docs/data/schema.md
- ใช้เป็น canonical ระดับ field ของทุก doc type
- Zod schema ฝั่ง client และ validate_doc_update ฝั่ง CouchDB ต้องตรงกับเอกสารนี้
```

ขอให้ทุกคนจำไว้ว่า `docs/data/schema.md` คือ source of truth ระดับ field และ `docs/data/data-model.md` คือ source of truth ระดับ architecture และ policy

ถ้าจะเพิ่ม แก้ หรือลบ doc type, field, enum, index, view, validation rule, replication behavior หรือ conflict policy ต้องอัปเดตเอกสารเหล่านี้และแจ้ง Project Owner ทุกครั้ง

### 5.1 Offline-First Mental Model

ระบบหลักเป็น offline-first:

```text
device (PouchDB) <-> central (CouchDB)
device (PouchDB) <-> edge fallback (CouchDB) เฉพาะตอน WAN/central เข้าไม่ได้
```

หลักการทำงาน:

- app เขียน local PouchDB ก่อนทุกครั้ง
- UI ห้าม block รอ network เพื่อให้เขียนข้อมูลได้แม้ offline
- sync ไป remote เป็น background process
- remote ปกติคือ Central CouchDB
- Edge CouchDB ใช้เป็น LAN fallback เฉพาะเมื่อ WAN หรือ central เข้าไม่ได้
- ถ้าทั้ง central และ edge เข้าไม่ได้ app จะอยู่ใน local-only mode

สิ่งที่ห้ามทำ:

```text
ห้ามให้ device run long-lived replication ไป central และ edge พร้อมกัน
ห้ามใช้ edge เป็น normal client hub
ห้ามออกแบบ flow ที่ต้องรอ network ก่อนจึงจะบันทึกข้อมูล operational ได้
ห้ามสร้าง id จาก server สำหรับ operational doc ที่ต้องเขียน offline
```

ตัวอย่างคำพูดตอน walkthrough:

```text
เวลา developer เขียน feature ที่มีการบันทึกข้อมูล ให้คิดก่อนว่า feature นี้ต้องทำงานได้ตอน offline หรือไม่

สำหรับ operational data ของศูนย์ เราจะเขียนเข้า local PouchDB ก่อน แล้วค่อย sync ไป central หรือ edge fallback

เพราะฉะนั้นการออกแบบ id, validation, conflict policy และ document shape ต้องรองรับ offline write ตั้งแต่แรก
```

---

## 6. CouchDB Database Design Principles

### 6.1 Database Topology และ Database Types

ระบบนี้มี database หลักตาม topology ใน `docs/data/data-model.md`

```text
shelter_{shelter_code}
- operational database ของแต่ละศูนย์
- 1 ศูนย์ = 1 database
- มีทั้ง central, edge fallback และ local PouchDB บน device

registry
- central-managed master
- pull ลง device และ edge เป็น read-only replica
- เก็บข้อมูลศูนย์และ config หลัก

catalog
- central-managed master
- pull ลง device และ edge เป็น read-only replica
- เก็บ supply_item, sop_profile, recipe

_users
- master อยู่ central
- edge ได้ filtered replica เฉพาะ user ของศูนย์ตนเพื่อ fallback login
- device ไม่เก็บ _users

central_ops
- อยู่ central เท่านั้น
- ใช้สำหรับ central-only service/read model เช่น search_audit, export_job, counter:shelter
```

หลักสำคัญ:

```text
1 shelter = 1 database
ปิดศูนย์ = หยุด replication + purge db ที่ central + wipe edge server
device เขียน operational data ใน local PouchDB ก่อน
registry/catalog เป็น read-only บน device
central_ops ไม่ replicate ลง edge หรือ device
```

### 6.2 วิธีสร้าง Database และ Provisioning Flow

Developer ห้าม manual create CouchDB database สำหรับ production flow โดยไม่มี provisioning record

การสร้าง database ของศูนย์ต้องผ่าน provisioning script หรือ workflow ที่ทีมกำหนดไว้ เพราะต้องสร้างหลายอย่างให้สอดคล้องกัน ทั้ง database, security, design docs, indexes, views, validation และ replication

Flow มาตรฐานสำหรับ provision ศูนย์ใหม่:

```text
1. Mint shelter.code ที่ central เท่านั้น
   - ใช้ central_ops:counter:shelter
   - read-modify-write value + 1
   - ถ้าเจอ _rev conflict หรือ 409 ให้ retry
   - code format: SH001, SH002, ... SH1000

2. สร้าง shelter doc ใน registry
   - type: shelter
   - code: SH001
   - status, capacity, zones, location, contact, opened_at

3. สร้าง database ชื่อ shelter_{shelter_code}
   - ใช้รูปแบบที่ provisioning กำหนดให้ตรงกันทั้งระบบ
   - อย่าประกอบชื่อ database เองใน feature code
   - ต้องให้ shelter_code ใน doc ตรงกับ database นี้

4. ตั้ง _security ของ shelter database
   - members.roles มี shelter role ของศูนย์นั้น
   - admins เป็น system_admin
   - central และ edge ต้องตั้งเหมือนกัน

5. Deploy design docs
   - _design/app
   - Mango indexes
   - CouchDB views
   - validate_doc_update

6. ติดตั้ง edge fallback replica สำหรับศูนย์นั้น
   - สร้าง db เดียวกันที่ edge
   - ตั้ง _security เหมือน central
   - ตั้ง replication docs สำหรับ edge <-> central backlog
   - ตั้ง filtered _users replication เฉพาะ user ของศูนย์

7. ตั้งค่า device local PouchDB
   - local db สำหรับ shelter_{shelter_code}
   - pull registry/catalog
   - sync active remote ไป central เป็นค่า default
   - switch ไป edge เฉพาะตอน WAN/central เข้าไม่ได้

8. Seed data เฉพาะ dev/test
   - ใช้ seed script feed sample docs ลง CouchDB docker
   - Playwright/e2e ควรชี้ CouchDB จริง ไม่ใช้ mock API เป็น source หลักของ data model
```

ข้อควรระวัง:

```text
ห้ามสร้าง shelter.code จาก device
ห้ามใช้ central counter กับ operational docs ที่ต้องเขียน offline
ห้ามสร้าง database โดยไม่ deploy validate_doc_update
ห้าม deploy design docs แค่ central แล้วลืม edge เพราะ edge อาจเป็น write target ตอน fallback
```

### 6.3 CouchDB Naming Convention

ให้ตั้งชื่อ database, doc type, `_id`, field และ enum ตามนี้

Database names:

```text
shelter_{shelter_code}
registry
catalog
central_ops
_users
```

Shelter code:

```text
SH001
SH002
SH003
SH1000
```

กติกา:

```text
shelter.code เป็น unique และ immutable
shelter.code mint จาก central counter เท่านั้น
ใช้ shelter.code เป็นชื่อ database และอ้างข้ามศูนย์ผ่าน shelter_code
pattern คือ SH + เลขอย่างน้อย 3 หลัก
1-999 pad เป็น 3 หลัก เช่น SH001
ตั้งแต่ 1000 ขึ้นไปใช้ความกว้างตามจริง เช่น SH1000
```

Document `_id`:

```text
_id = "{type}:{ulid}"
```

ตัวอย่าง:

```text
evacuee:01J0ABCDEF1234567890ABCDEF
medical:01J0ABCDEF1234567890ABCDEF
household:01J0ABCDEF1234567890ABCDEF
movement:01J0ABCDEF1234567890ABCDEF
stock_ledger:01J0ABCDEF1234567890ABCDEF
donation:01J0ABCDEF1234567890ABCDEF
```

กติกา `_id`:

```text
client สร้าง ULID เองตอน offline ได้ทันที
ULID ใช้เป็น idempotency key ในตัว
retry write doc เดิมแล้วเจอ 409 ให้ถือว่าเป็น expected conflict แล้ว fetch/verify ก่อนตัดสินใจ
ห้ามใช้ CouchDB-generated id
ห้ามใช้ sequence กลางสำหรับ operational docs
_id ต้องขึ้นต้นด้วย type:
type ต้องตรงกับ discriminator field ใน document
```

ข้อยกเว้นสำหรับ deterministic หรือ singleton id:

```text
meal_plan:{date}:{meal}
meal_service:{date}:{meal}
config:app
counter:shelter
```

เหตุผลของ deterministic id คือกันสร้างเอกสารซ้ำในสิ่งที่ควรมีแค่หนึ่งชุด เช่น meal plan หนึ่งวันหนึ่งมื้อ ถ้าสอง device สร้างพร้อมกันให้ชนเป็น conflict เพื่อ resolve ไม่ใช่กลายเป็น doc ซ้ำ

Doc type และ enum:

```text
type ใช้ภาษาอังกฤษ lower_snake
enum เก็บเป็น string ภาษาอังกฤษ lower_snake
label ภาษาไทยอยู่ฝั่ง UI
```

ตัวอย่าง:

```text
type: "stock_ledger"
status: "checked_in"
reason: "transfer_out"
track: "fast_track"
registered_via: "paper"
```

Field names:

```text
ใช้ lower_snake ใน CouchDB documents
timestamp ใช้ suffix _at เช่น created_at, updated_at, occurred_at, screened_at
reference id ใช้ suffix _id เช่น evacuee_id, household_id, item_id
boolean ใช้ชื่อที่อ่านเป็น condition เช่น anonymized, public_otp_required
array ใช้ plural หรือชื่อที่บอกว่าเป็น collection เช่น symptoms, medications, allergies
```

### 6.4 Common Document Envelope

ทุก document ต้องมี common envelope ตาม `docs/data/schema.md` และ document ใน `shelter_{shelter_code}` ต้องมี `shelter_code` เพื่อกัน doc หลง database

```text
_id
_rev
type
schema_v
shelter_code
created_at
updated_at
created_by
```

ความหมาย:

```text
_id:
- client เป็นผู้สร้าง
- format หลักคือ "{type}:{ulid}"

_rev:
- CouchDB เป็นผู้สร้าง
- ใช้สำหรับ MVCC และ update conflict
- ห้าม developer สร้างเอง

type:
- discriminator ของ document
- ต้องตรงกับชื่อ doc type ใน schema

schema_v:
- version ของ schema สำหรับ doc type นั้น
- เริ่มที่ 1
- ใช้ตอน transform หรือ upgrade document shape

shelter_code:
- code ของศูนย์ เช่น SH001
- ต้องใส่ทุก doc ใน shelter_{shelter_code}
- ใช้ตรวจว่า document อยู่ถูก shelter database
- validate_doc_update ต้องตรวจว่า shelter_code ตรงกับ database

created_at / updated_at:
- ISO-8601 UTC
- append-only types ให้สองค่านี้เท่ากันเสมอ

created_by:
- _users name ของผู้สร้าง document
```

ตัวอย่าง common envelope:

```json
{
  "_id": "movement:01J0ABCDEF1234567890ABCDEF",
  "type": "movement",
  "schema_v": 1,
  "shelter_code": "SH001",
  "created_at": "2026-06-17T03:00:00.000Z",
  "updated_at": "2026-06-17T03:00:00.000Z",
  "created_by": "staff001"
}
```

### 6.5 เริ่มจาก Doc Type ไม่ใช่ Field

ก่อนเพิ่ม field หรือ doc type ใหม่ ให้เริ่มจากการถามว่าเรากำลังเก็บ document ประเภทอะไร และ lifecycle ของมันเป็นแบบไหน

คำถามที่ต้องตอบก่อนออกแบบ:

```text
ข้อมูลนี้เป็น doc type ใหม่หรือ field ของ doc type เดิม
document นี้อยู่ db ไหน: shelter_{code}, registry, catalog หรือ central_ops
document นี้ mutable, append-only, state machine, deterministic หรือ singleton
ต้องเขียน offline ได้ไหม
ต้อง sync ไป central/edge/device อย่างไร
ต้องมี view หรือ Mango index เพื่อ query หรือไม่
ต้องมี retention หรือ purge rule หรือไม่
ต้องมี role ไหนอ่าน/เขียนได้บ้าง
ถ้าเกิด conflict จะ resolve อย่างไร
```

Doc type กลุ่มหลักใน `shelter_{shelter_code}`:

```text
People:
- evacuee
- medical
- household
- movement
- screening

Operations:
- stock_ledger
- stock_transfer
- donation
- donation_campaign
- meal_plan
- kitchen_requisition
- meal_service
- volunteer
- shift_assignment
- security_event
- referral
- audit
```

Doc type กลุ่มอื่น:

```text
registry:
- shelter
- config

catalog:
- supply_item
- sop_profile
- recipe

central_ops:
- search_audit
- export_job
- counter:shelter
```

### 6.6 Mutability Model

ก่อนออกแบบ document ต้องระบุ mutability model ให้ชัด

```text
Mutable LWW:
- document แก้ไขได้
- ใช้ updated_at ช่วยตัดสิน last-write-wins
- ตัวอย่าง: evacuee, medical, household, volunteer, shift_assignment

Append-only:
- สร้างแล้วห้าม update/delete
- ใช้เก็บ event หรือ ledger
- ตัวอย่าง: movement, screening, stock_ledger, kitchen_requisition, meal_service, security_event, audit

State machine:
- update status ได้ แต่ต้องไปข้างหน้าเท่านั้น
- transition ถอยหลังต้องถูกปฏิเสธ
- ตัวอย่าง: stock_transfer, donation, referral

Deterministic/singleton:
- _id ตายตัวเพื่อกัน document ซ้ำ
- ตัวอย่าง: meal_plan:{date}:{meal}, meal_service:{date}:{meal}, config:app
```

หลักสำคัญ:

```text
ถ้าเป็นเหตุการณ์ที่เกิดขึ้นจริงในเวลาใดเวลาหนึ่ง ให้คิด append-only ก่อน
ถ้าเป็นสถานะปัจจุบันที่ user แก้ได้ ให้คิด mutable LWW
ถ้ามี status lifecycle ให้คิด state machine และ forward-only transition
ถ้าสิ่งนั้นควรมีแค่หนึ่ง doc ต่อ key ให้ใช้ deterministic id
```

ตัวอย่าง:

```text
movement คือ event เข้า/ออก/ย้าย จึงเป็น append-only
current_stay ใน evacuee เป็น snapshot เพื่อ UI เท่านั้น
ถ้า current_stay ขัดกับ movement ให้ movement events ชนะเสมอ
```

### 6.7 Relationship และการลด Conflict

CouchDB ไม่มี foreign key constraint แบบ relational database ดังนั้น relationship ต้องออกแบบผ่าน reference id และ validation policy

กติกา:

```text
ใช้ reference id เช่น evacuee_id, household_id, item_id, campaign_id
ห้ามเก็บ list ย้อนกลับถ้าจะทำให้เกิด conflict ง่าย
อย่าเก็บข้อมูลซ้ำถ้า source of truth อยู่ที่ doc type อื่น
ถ้าต้อง denormalize เพื่อ UI ต้องระบุ source of truth และ repair rule
```

ตัวอย่างจาก schema:

```text
household ไม่เก็บ list สมาชิก
สมาชิก = evacuee ที่ household_id ชี้มายัง household นั้น
เหตุผลคือถ้าเก็บ member list ใน household หลาย device จะ update list เดียวกันแล้ว conflict ง่าย
```

อีกตัวอย่าง:

```text
stock balance ไม่เก็บเป็น running total
source of truth คือ stock_ledger append-only
balance คำนวณจาก view stock_balance
```

### 6.8 Read Models, Views และ Mango Indexes

ใน CouchDB ห้ามสร้าง aggregate document โดยไม่จำเป็น ถ้าเป็น aggregate ที่คำนวณจาก event หรือ ledger ให้ใช้ CouchDB views หรือ client computation ตามที่ data model กำหนด

Read model หลักอยู่ใน design doc:

```text
_design/app
```

Views หลัก:

```text
occupancy:
- map movement
- reduce _count ตาม status
- ใช้ dashboard และ occupancy guard

stock_balance:
- map stock_ledger item และ qty
- reduce _sum
- ใช้ stock dashboard และ reorder alert

latest_screening:
- map screening by evacuee_id และ screened_at
- ใช้ผลคัดกรองล่าสุด

meals_served:
- reduce _sum ต่อวัน/มื้อ
- ใช้ kitchen dashboard

needs_open:
- donation_campaign ลบ donation declared/received
- ใช้ public needs
```

Mango indexes ที่ต้อง deploy พร้อม provisioning:

```text
evacuee(last_name, first_name)
evacuee(phone)
evacuee(household_id)
evacuee(current_stay.status)
movement(evacuee_id, occurred_at)
screening(evacuee_id, screened_at)
stock_ledger(item_id, occurred_at)
donation(status)
donation(tracking_token_hash)
donation(campaign_id)
medical(evacuee_id)
shift_assignment(date, shift)
shift_assignment(volunteer_id, date)
```

หลักการ:

```text
ถ้า query สำคัญ ต้องมี index หรือ view รองรับ
ถ้าเป็น aggregate จาก event/ledger ให้คิด view ก่อน
ถ้าต้อง join ข้าม db เช่น recipe กับ stock balance ให้คำนวณฝั่ง client ตาม data-model
ห้ามเพิ่ม field aggregate เพื่อความสะดวกโดยไม่ระบุ source of truth และ conflict policy
```

### 6.9 Validation และ Security

Validation ต้องอยู่ทั้งฝั่ง client และ CouchDB

```text
Client:
- ใช้ Zod schema
- ต้องตรงกับ docs/data/schema.md

CouchDB:
- ใช้ validate_doc_update
- ต้อง deploy ทั้ง central และ edge
- เพราะ edge อาจเป็น active write target ตอน LAN fallback
```

`validate_doc_update` ต้องบังคับอย่างน้อย:

```text
1. type อยู่ใน whitelist ของ database นั้น
2. _id ขึ้นต้นด้วย "{type}:"
3. append-only types ปฏิเสธ update/delete ทุกกรณี
4. state machine types ปฏิเสธ transition ถอยหลัง
5. role -> type เขียนได้ตาม role-permission-matrix
6. shelter_code ใน doc ต้องตรงกับ database
7. required fields และ enum สำคัญถูกต้อง
```

Security:

```text
Auth ใช้ CouchDB _session cookie
app login กับ central ก่อนเสมอ
ถ้า WAN/central เข้าไม่ได้จึง login กับ edge fallback ของศูนย์ตน
central และ edge ออก session cookie แยกกัน
edge session ใช้ sync กับ edge เท่านั้น ไม่ grant central API
สร้าง/แก้ user ทำที่ central เท่านั้น
device ไม่เก็บ _users
```

บทพูดสำคัญ:

```text
เราห้าม rely แค่ frontend validation เพราะ CouchDB อาจรับ write จาก edge ตอน fallback ได้

ดังนั้น schema, role rule และ append-only/state-machine rule ต้องอยู่ใน validate_doc_update ด้วย และต้อง deploy ทั้ง central และ edge
```

### 6.10 Write, Update และ Delete Rules

Create document:

```text
1. สร้าง _id ฝั่ง client ด้วย "{type}:{ulid}"
2. ใส่ common envelope ให้ครบ
3. ใส่ type ให้ตรงกับ _id prefix
4. ใส่ schema_v
5. ใส่ shelter_code ให้ตรงกับ db
6. เขียน local PouchDB ก่อน
7. ให้ sync ทำงาน background
```

Update mutable document:

```text
1. fetch document ล่าสุดพร้อม _rev
2. แก้ field ที่จำเป็น
3. set updated_at ใหม่
4. put ทั้ง document กลับเข้า PouchDB/CouchDB
5. ถ้าเจอ 409 ให้ refetch, merge ตาม rule ของ feature แล้ว retry หรือ escalate
```

Append-only document:

```text
สร้างใหม่เท่านั้น
ห้าม update
ห้าม delete
created_at และ updated_at เท่ากัน
ถ้าแก้ย้อนหลังต้องสร้าง audit หรือ correction event ตาม spec
```

State machine document:

```text
update status ได้เฉพาะไปข้างหน้า
ต้องมี timeline หรือ timestamp ของ transition เมื่อ schema กำหนด
transition ที่ถอยหลังต้องถูก reject
ถ้า transition ไม่ชัด ให้ถาม Project Owner
```

Delete/Purge:

```text
ห้าม delete operational docs เองโดยไม่มี policy
PDPA retention ใช้ purge/tombstone ตาม data-model
medical purge ก่อนตามวงจร
evacuee/household แทนที่ด้วย tombstone ไร้ PII
local db บน device อายุ 1 เดือนตาม SOP
edge server wipe ตอนปิดศูนย์
```

### 6.11 Sync และ Conflict Policy

Active remote ของ device มีได้ทีละหนึ่งเป้าหมาย:

```text
Central CouchDB:
- normal mode
- device <-> central แบบ live + retry

Edge CouchDB:
- fallback เฉพาะ WAN/central เข้าไม่ได้
- device <-> edge
- edge sync backlog กลับ central เมื่อ WAN กลับมา

Local-only:
- เมื่อ central และ edge เข้าไม่ได้
- เขียน local ได้ แล้วรอ sync ภายหลัง
```

Conflict policy:

```text
Append-only:
- โดยปกติไม่มี conflict เพราะ _id เป็น ULID ไม่ชนกัน
- ห้าม update/delete

Mutable:
- ใช้ LWW ด้วย updated_at
- central repair job ตรวจ _conflicts
- revision ที่แพ้ถูกเก็บลง audit แล้วลบ conflict branch

State machine:
- forward-only
- status ที่ไปข้างหน้ากว่าชนะ

current_stay snapshot:
- movement events ชนะเสมอ
- repair job sync snapshot ให้ตรงกับ movement view
```

สิ่งที่ developer ต้องระวัง:

```text
อย่าแก้ conflict แบบเงียบ ๆ ใน UI ถ้าเป็น business decision
อย่า update append-only doc เพื่อแก้ข้อมูลเก่า
อย่าเพิ่ม snapshot field โดยไม่มี source-of-truth rule
อย่าออกแบบ flow ที่ทำให้หลาย device ต้อง update document เดียวกันบ่อย ๆ
```

### 6.12 Public Tier และ MongoDB Projection

Public tier และ deferred EOC/Open API ไม่ได้อ่าน operational CouchDB โดยตรง แต่ใช้ MongoDB projection ที่ sync จาก central

หลักการ:

```text
operational write อยู่ที่ PouchDB/CouchDB
public tier อ่านจาก MongoDB projection
EOC/Open API เป็น deferred service แยก
ห้ามเพิ่ม operational doc type เฉพาะ public tier โดยไม่ผ่าน data model
ถ้า purge CouchDB ต้องลบข้อมูลฝั่ง MongoDB projection แยกด้วย เพราะ _purge ไม่ออกใน _changes feed
```

---

## 7. CouchDB Schema Change Policy

ถ้า developer พบว่า schema ปัจจุบันไม่รองรับ feature หรือมีวิธีออกแบบที่เหมาะสมกว่า สามารถเสนอเปลี่ยนแปลง schema ได้ตามความเหมาะสม

แต่มี rule สำคัญคือ:

```text
ทุกครั้งที่ต้องการเปลี่ยน CouchDB schema, doc type, field, view, index, validation, replication, conflict policy หรือ retention rule ต้องแจ้ง Project Owner
```

การแจ้ง Project Owner ไม่ได้มีไว้เพื่อ block การทำงาน แต่มีไว้เพื่อให้ทีม track ได้ว่า data model เปลี่ยนเมื่อไหร่ เปลี่ยนเพราะอะไร และกระทบอะไรบ้าง

ก่อนเปลี่ยน schema ให้แจ้งข้อมูลอย่างน้อย:

```text
1. เปลี่ยนอะไร
   - database, doc type, field, enum, id pattern, index, view, validation หรือ security rule

2. เหตุผลที่ต้องเปลี่ยน
   - requirement ไหนรองรับไม่ได้
   - YAGNI check แล้วหรือยัง

3. กระทบอะไร
   - feature, UI, API, sync, conflict, report, public projection หรือ retention

4. Mutability model คืออะไร
   - mutable, append-only, state machine, deterministic หรือ singleton

5. ต้องเปลี่ยนเอกสารหรือ code ส่วนไหน
   - docs/data/schema.md
   - docs/data/data-model.md
   - Zod schema
   - validate_doc_update
   - Mango indexes / CouchDB views
   - role-permission-matrix
   - seed script / tests

6. มี data transform, backfill หรือ migration ไหม
   - ต้อง upgrade schema_v หรือไม่
   - ต้อง backfill field หรือไม่
   - ต้อง rebuild view/index หรือไม่
   - rollback หรือ repair plan คืออะไร

7. ต้องการ decision หรือแจ้งเพื่อรับทราบ
```

ตัวอย่างข้อความแจ้ง:

```text
ขอแจ้ง proposed CouchDB schema change ครับ

ต้องการเพิ่ม field `needs_referral` ใน doc type `screening`
DB: shelter_{shelter_code}
Mutability: append-only
เหตุผล: ใช้แยกเคสที่ต้องส่งต่อหลังคัดกรอง ตาม flow medical triage
ผลกระทบ: screening form, latest_screening view, medical dashboard, seed data และ Zod schema
Validation: เพิ่ม required bool default false ใน client schema และ validate_doc_update
Index/View: ไม่เพิ่ม index ใหม่ แต่ latest_screening ต้อง expose field นี้
Data transform: ไม่มี เพราะ append-only doc ใหม่จะเริ่มมี field นี้; doc เก่าต้อง handle fallback false
รบกวน Project Owner confirm ว่า field นี้ตรงกับ triage flow หรือไม่ครับ
```

ตัวอย่างการเปลี่ยนที่ต้องแจ้งแน่นอน:

```text
เพิ่ม database ใหม่
เพิ่ม doc type ใหม่
ลบ doc type
เพิ่ม field ที่มีผลต่อ business logic
ลบ field
เปลี่ยน field type
เปลี่ยน required/optional/default
เปลี่ยน enum หรือ status
เปลี่ยน mutability model
เปลี่ยน _id pattern
เปลี่ยน deterministic id
เพิ่มหรือแก้ Mango index
เพิ่มหรือแก้ CouchDB view
แก้ validate_doc_update
แก้ role -> type permission
แก้ _security หรือ user role model
แก้ replication topology
แก้ conflict policy
แก้ retention/purge/tombstone rule
แก้ MongoDB projection/public tier mapping
```

ถ้า schema change มีความเสี่ยงสูง เช่น เปลี่ยน `_id`, เปลี่ยน enum/status, เปลี่ยน append-only เป็น mutable, เปลี่ยน conflict policy, เปลี่ยน retention หรือแก้ validation ที่ทำให้ doc เก่าเขียนต่อไม่ได้ ต้องรอ confirmation ก่อนทำ

---

## 8. Working With Spec

Spec คือ reference หลักของทีม

ถ้า spec ชัด ให้ทำตาม spec

ถ้า spec ไม่ชัด อย่าเดาเองโดยไม่แจ้ง

ถ้าเจอปัญหาเกี่ยวกับ requirement, business rule, wording, permission, validation, user flow หรือ expected behavior ให้ถาม Project Owner

ตัวอย่างคำถามที่ควรถาม Project Owner:

```text
กรณี evacuee check_out แล้วกลับมา check_in ใหม่ ต้องสร้าง movement ใหม่หรือแก้ snapshot เดิม
donation status มีค่าอะไรบ้าง และ transition ใดถอยหลังไม่ได้
shelter_manager เห็นข้อมูล medical ของทุกคนในศูนย์หรือไม่
field นี้จำเป็นต้องกรอกไหม ตาม docs/data/schema.md
ถ้าข้อมูลไม่ครบควร block หรือ allow draft
เมื่อ donation หมดอายุควรเปลี่ยน status อัตโนมัติเป็น expired โดย job หรือให้ staff กดเอง
```

หลักจำง่าย ๆ คือ:

```text
ถ้าคำถามคือ "ระบบควรทำอะไร" ให้ถาม Project Owner
```

เวลาถาม Project Owner ควรถามให้ชัดและมี context ไม่ควรถามกว้าง ๆ ว่า "อันนี้ทำยังไง" แต่ควรอธิบายว่าเจออะไร มี option อะไร และแต่ละ option กระทบอะไร

ตัวอย่างที่ดี:

```text
ใน spec ระบุว่า evacuee สามารถ transfer_out ได้ แต่ไม่ได้ระบุว่าต้องบันทึก destination แบบละเอียดแค่ไหน

มี 2 option:
1. บังคับเลือก destination.kind และกรอก shelter_code เมื่อ destination เป็น shelter
2. ให้กรอก destination.detail เป็น free text ก่อน แล้วค่อย normalize ภายหลัง

รบกวน Project Owner confirm rule ที่ต้องการครับ เพราะจะมีผลต่อ movement schema, validation และ report
```

การถามแบบนี้ช่วยให้ Project Owner ตัดสินใจง่าย และช่วยให้ทีมมี record สำหรับการเปลี่ยนแปลง

---

## 9. Technical Issue Flow

ถ้าเป็นปัญหาด้านเทคนิค ให้ถาม Student Lead ก่อน

ตัวอย่าง technical issue:

```text
API route ควรวางตรงไหน
component นี้ควรแยกอย่างไร
query นี้ควรเขียนแบบไหนดี
CouchDB 409 conflict หรือ design doc deployment error แก้อย่างไร
state management ควรจัดแบบไหน
library นี้ควรใช้หรือไม่
test case นี้ควร mock อย่างไร
performance issue นี้ควรแก้ตรงไหน
```

ลำดับคือ:

```text
Developer -> Student Lead
```

ถ้าคุยกับ Student Lead แล้วพบว่าปัญหานั้นทำให้ต้องเปลี่ยน spec, เปลี่ยน flow, ปรับ scope, เปลี่ยน CouchDB schema/data model หรือกระทบ timeline ให้ escalate ไป Project Owner

ลำดับเมื่อ technical issue กระทบ decision:

```text
Developer -> Student Lead -> Project Owner
```

ตัวอย่าง:

```text
Developer พบว่า report stock balance ต้องใช้ view ใหม่ ไม่ใช่ query document ทีละรายการ
Developer คุยกับ Student Lead เรื่อง technical approach
Student Lead เห็นว่าต้องเพิ่ม CouchDB view ใน _design/app และ update provisioning
ทีมต้องแจ้ง Project Owner เพราะกระทบ data model, report และ versioning
```

หลักสำคัญคือ technical decision ที่อยู่แค่ใน code อาจให้ Student Lead ช่วยตัดสินใจได้ แต่ technical decision ที่กระทบ spec, CouchDB schema, data model, user flow หรือ scope ต้องแจ้ง Project Owner

---

## 10. UI Change Policy

ส่วนของ UI สามารถปรับตามความเหมาะสมได้ โดยเฉพาะการปรับเพื่อให้ใช้งานง่ายขึ้น อ่านง่ายขึ้น responsive ดีขึ้น หรือสอดคล้องกับ component structure ของโปรเจกต์

อย่างไรก็ตาม ถ้า UI change มีผลต่อ product behavior หรือ user flow ต้องแจ้ง Project Owner หรือ Product Owner

ตัวอย่าง UI change ที่สามารถปรับได้ตามความเหมาะสม:

```text
spacing
alignment
responsive layout
button placement ที่ไม่เปลี่ยน flow
component organization
visual consistency
minor wording ที่ไม่เปลี่ยนความหมาย
```

ตัวอย่าง UI change ที่ต้องแจ้ง Project Owner หรือ Product Owner:

```text
เปลี่ยนลำดับ step ของ form
เพิ่มหรือลบปุ่ม action
เปลี่ยน field ที่ user ต้องกรอก
เปลี่ยน wording ที่มีผลต่อความเข้าใจ
เปลี่ยน flow จากหลายหน้าเป็นหน้าเดียว
ซ่อนหรือเพิ่มข้อมูลสำคัญ
เปลี่ยน validation message สำคัญ
เปลี่ยน confirmation behavior
เปลี่ยน default value ที่ user เห็น
```

หลักจำง่าย ๆ คือ:

```text
ถ้า UI change กระทบสิ่งที่ user เห็น เข้าใจ หรือตัดสินใจ ต้องแจ้ง Project Owner หรือ Product Owner
```

การแจ้งไม่ได้แปลว่าห้ามปรับ แต่เพื่อให้ทีมสามารถ track ได้ว่า UI เปลี่ยนเพราะอะไร และ product decision เปลี่ยนตามหรือไม่

---

## 11. Change Tracking

ทุกการเปลี่ยนแปลงที่มีผลต่อ spec, CouchDB schema/data model, API contract หรือ UI flow ต้องมี record

เหตุผลที่ต้อง track change:

- เพื่อเขียนรายงานได้ถูกต้อง
- เพื่อทำ versioning ได้แม่นยำ
- เพื่อ debug regression ได้
- เพื่อให้ทีมรู้ว่า decision เปลี่ยนเมื่อไหร่
- เพื่อให้ Project Owner และ Product Owner เห็น impact
- เพื่อช่วย review และ handoff งาน

เวลาส่ง PR หรือส่งงาน ให้ระบุข้อมูลสำคัญดังนี้

```text
Summary:
- เปลี่ยนอะไร

Reason:
- ทำไมต้องเปลี่ยน

Impact:
- กระทบ feature, API, database หรือ UI ไหนบ้าง

Database:
- มี CouchDB schema, doc type, field, view, index หรือ validate_doc_update change ไหม
- มี data transform, schema_v update หรือ provisioning change ไหม

Spec/UI:
- มี deviation จาก spec เดิมไหม
- แจ้ง Project Owner หรือ Product Owner แล้วหรือยัง

Testing:
- ทดสอบอะไรแล้วบ้าง
- ยังมี risk หรือ test gap อะไรอยู่
```

ตัวอย่าง PR description:

```text
Summary:
- เพิ่ม field `needs_referral` ใน screening flow
- เพิ่ม validation สำหรับ medical triage
- อัปเดต seed data สำหรับ screening append-only docs

Reason:
- รองรับ requirement ที่ staff ต้อง flag evacuee ที่ต้องส่งต่อหลังคัดกรอง

Impact:
- กระทบ screening form, medical dashboard, latest_screening view consumer และ report

Database:
- เพิ่ม field `needs_referral` ใน doc type `screening`
- DB: shelter_{shelter_code}
- Mutability: append-only
- validate_doc_update ต้องยอมรับ required bool default false
- แจ้ง Project Owner แล้วเมื่อ 2026-06-17

Spec/UI:
- UI เพิ่ม toggle ใน screening form
- แจ้ง Product Owner แล้วเพราะ field นี้กระทบ medical triage flow

Testing:
- ทดสอบ create screening doc สำเร็จ
- ทดสอบ fallback false สำหรับ doc เก่า
- ยังไม่ได้ทดสอบ conflict repair job บน central
```

---

## 12. Practical Walkthrough Flow

เวลาทำ walkthrough กับทีม ให้ใช้ flow นี้เป็นลำดับการเปิดไฟล์และลำดับการพูดกับ developer

เป้าหมายของ section นี้คือให้ทีมเห็น pattern การพัฒนา frontend จาก codebase จริง ตั้งแต่ config, route guard, feature layer, PouchDB local-first flow, service-plane API flow, form pattern, UI pattern, testing และ review checklist

### Step 0: ตั้ง source of truth ก่อนเริ่มดู code

ให้เปิดไฟล์เหล่านี้ก่อน:

```text
frontend/CONTRIBUTING.md
frontend/CONVENTIONS.md
frontend/AGENTS.md
frontend/package.json
frontend/svelte.config.js
frontend/vite.config.ts
frontend/eslint.config.js
docs/data/schema.md
docs/data/data-model.md
```

สิ่งที่ต้องพูด:

```text
frontend/CONTRIBUTING.md คือ working agreement ของ frontend package
frontend/CONVENTIONS.md คือ naming, structure และ coding convention
docs/data/schema.md คือ source of truth ระดับ field/doc type
docs/data/data-model.md คือ source of truth ระดับ CouchDB topology/policy

ถ้าเอกสารเก่าบางจุดไม่ตรงกับ codebase ปัจจุบัน ให้ยึด CONTRIBUTING.md และ actual src tree เป็นหลัก
```

ตัวอย่างคำพูด:

```text
ก่อนเขียน feature ใหม่ เราต้องแยกให้ได้ก่อนว่า feature นี้เป็น local-first PouchDB feature, service-plane/API feature หรือ UI-only change

เพราะแต่ละแบบมี implementation path และ testing path ไม่เหมือนกัน
```

### Step 1: อธิบายภาพรวม frontend runtime

ให้เปิด:

```text
frontend/package.json
frontend/svelte.config.js
frontend/src/routes/+layout.ts
frontend/src/routes/+layout.svelte
```

อธิบายภาพรวม:

```text
SvelteKit v2 + Svelte 5 runes
SPA/PWA served by Node adapter
ssr = false ที่ src/routes/+layout.ts
TanStack Query เป็น client-side data fetching layer
Superforms + Zod เป็น form/validation layer
PouchDB เป็น local database
CouchDB เป็น remote sync target
service/admin calls ใช้ same-origin /api/* endpoint
UI primitives อยู่ใน src/lib/components/ui
toast อยู่ที่ root layout ผ่าน svelte-sonner
```

สิ่งที่ต้องชี้ใน `+layout.ts`:

```text
สร้าง QueryClient
ตั้ง prerender = true
ตั้ง ssr = false
ตั้ง trailingSlash = 'never'
```

สิ่งที่ต้องชี้ใน `+layout.svelte`:

```text
QueryClientProvider ครอบทั้ง app
Toaster อยู่ global
SvelteQueryDevtools เปิดไว้
เมื่อ authStore.isAuthenticated:
- startNamedSync(SHELTER_DB, markNeedsReauth)
- startPeopleLiveQuery(data.queryClient)
เมื่อ cleanup:
- live.stop()
- stopNamedSync(SHELTER_DB)
```

ตัวอย่างคำพูด:

```text
โปรเจกต์นี้เป็น SPA ดังนั้น page data ไม่ควรพึ่ง server load
ถ้าเป็น operational data ให้คิด local PouchDB ก่อน แล้วปล่อย sync ทำงาน background
ถ้าเป็นงานที่ต้องใช้ admin credential หรือ central-only authority ให้ไปผ่าน /api/* service route
```

### Step 2: อธิบาย folder structure และ feature boundary

ให้เปิด:

```text
frontend/src/routes/
frontend/src/routes/(protected)/
frontend/src/lib/features/
frontend/src/lib/db/
frontend/src/lib/guards/
frontend/src/lib/stores/
frontend/src/lib/server/
frontend/src/lib/components/ui/
frontend/eslint.config.js
```

อธิบาย:

```text
routes:
- เป็น entry point ของหน้า
- protected page อยู่ใน src/routes/(protected)/
- page load ใช้ guard กลาง

features:
- feature-sliced modules
- ปกติแบ่ง domain, data, application, ui, index.ts
- route และ feature อื่น import ผ่าน index.ts เท่านั้น

db:
- shared CouchDB/PouchDB primitives
- model, ulid, repository, live-query, pouch, couch

guards:
- requireAuth, requireAdmin, requireManager, redirectIfAuthenticated

stores:
- shared reactive state เช่น authStore

server:
- server-only code เช่น CouchDB admin client และ user-service
- ห้าม import เข้า client bundle

components/ui:
- generated shadcn-svelte primitives
- ห้าม hand-edit โดยตรง
```

ให้ชี้ `no-restricted-imports` ใน `eslint.config.js`:

```text
route หรือ feature อื่นห้าม import:
$lib/features/*/domain/*
$lib/features/*/data/*
$lib/features/*/application/*
$lib/features/*/ui/*

ให้ import จาก:
$lib/features/<feature>
```

ตัวอย่างคำพูด:

```text
ถ้าต้องใช้ symbol ใหม่จาก feature ให้เพิ่ม export ใน index.ts
อย่า import ทะลุเข้า inner layer เพราะจะทำให้ feature boundary พังและ refactor ยาก
```

### Step 3: อธิบาย CouchDB data model ปัจจุบัน

เปิด `docs/data/data-model.md` และ `docs/data/schema.md` แล้วอธิบาย topology, database, doc type และ field หลัก

ตัวอย่างคำพูด:

```text
ตรงนี้คือ data model ปัจจุบันของระบบ ขอให้ทุกคนดูจาก topology ก่อนว่า device, central และ edge ทำงานร่วมกันอย่างไร

จากนั้นเราจะดู database หลัก เช่น shelter_{shelter_code}, registry, catalog และ central_ops แล้วค่อยลงไปที่ doc type ว่าแต่ละ doc type แทน concept อะไร มี mutability แบบไหน และ query ผ่าน view/index อะไร
```

หัวข้อที่ควรพูด:

```text
database หลักคืออะไร
doc type หลักคืออะไร
_id pattern คืออะไร
common envelope มี field อะไรบ้าง
doc type ไหนเป็น mutable, append-only, state machine หรือ deterministic
reference id เชื่อม document อะไรกับอะไร
status/enum มีค่าอะไรบ้าง
field ไหน required, optional หรือ sys
view และ Mango index สำคัญมีอะไรบ้าง
validate_doc_update บังคับ rule อะไร
conflict policy ของแต่ละกลุ่มเป็นอย่างไร
retention/purge rule กระทบ doc type ไหนบ้าง
```

จากนั้นเปิด shared primitives:

```text
frontend/src/lib/db/model.ts
frontend/src/lib/db/ulid.ts
frontend/src/lib/db/repository.ts
frontend/src/lib/db/live-query.ts
frontend/src/lib/db/pouch.ts
frontend/src/lib/db/couch.ts
```

อธิบาย:

```text
model.ts:
- BaseDoc คือ common envelope
- makeDocId สร้าง "{type}:{ulid}"
- makeDoc stamp _id, type, schema_v, shelter_code, created_at, updated_at, created_by
- touch bump updated_at สำหรับ mutable docs

ulid.ts:
- client mint ULID ได้ตอน offline
- ULID เป็น idempotency key และ sort ตามเวลาได้

repository.ts:
- createRepository เป็น wrapper กลางของ local PouchDB
- allByType ใช้ prefix scan ตาม _id convention

live-query.ts:
- PouchDB changes feed -> TanStack Query invalidation
- live data ไม่ใช้ polling เป็นหลัก

pouch.ts:
- namedLocalDb, startNamedSync, stopNamedSync
- sync ใช้ cookie auth
- 401/403 จะ stop sync แล้ว markNeedsReauth

couch.ts:
- couchFetch ใช้ CouchDB _session cookie
- sessionLogin, sessionLogout, getSession
```

ตัวอย่างคำพูด:

```text
ถ้า feature ใหม่ต้องสร้าง CouchDB document ให้เริ่มจาก domain factory ที่เรียก makeDoc
ห้ามสร้าง _id หรือ timestamp แบบ ad hoc ใน component
และถ้า feature ต้อง reactive จาก local write หรือ sync ให้ใช้ changes feed invalidation pattern
```

### Step 4: อธิบาย route, auth และ protected layout pattern

ให้เปิด:

```text
frontend/src/lib/stores/auth.svelte.ts
frontend/src/lib/guards/auth.ts
frontend/src/routes/(protected)/+layout.ts
frontend/src/routes/(protected)/+layout.svelte
frontend/src/routes/login/+page.ts
frontend/src/routes/login/+page.svelte
```

สิ่งที่ต้องอธิบาย:

```text
authStore:
- เก็บ user และ needsReauth
- cache identity ใน localStorage
- แยก identity ออกจาก sync-auth
- sync session หมดอายุแล้ว markNeedsReauth ไม่ใช่ logout ทันที

guards:
- requireAuth สำหรับ protected pages
- requireAdmin สำหรับ system admin
- requireManager สำหรับ system admin หรือ shelter_manager
- redirectIfAuthenticated สำหรับ login page

protected layout:
- nav แสดงตาม role
- canManageUsers = system admin หรือ shelter_manager
- needsReauth banner บอกว่า changes saved locally แต่ยังไม่ sync
- logout เรียก authStore.logout แล้ว goto login
```

ข้อห้าม:

```text
ห้ามสร้าง auth guard เองถ้าใช้ guard กลางได้
ห้าม force logout เมื่อ sync session หมดอายุ
ห้ามใช้ JWT/access token เพราะ auth model คือ CouchDB _session cookie
ห้ามใส่ admin credential ใน client หรือ PUBLIC_* env
```

ตัวอย่างคำพูด:

```text
offline-first UX สำคัญมาก
ถ้า session หมด ระบบยังให้ user ทำงาน local ต่อได้ แล้วค่อย re-login เพื่อ sync
ดังนั้นอย่าแก้ sync 401/403 ให้ redirect ออกจาก app โดยไม่คุยกับ Project Owner
```

### Step 5: อธิบาย feature-sliced architecture

ให้เปิด feature reference:

```text
frontend/src/lib/features/people/
frontend/src/lib/features/people/domain/people.ts
frontend/src/lib/features/people/data/people.repository.ts
frontend/src/lib/features/people/data/people.pouch.ts
frontend/src/lib/features/people/application/queries.ts
frontend/src/lib/features/people/ui/evacuee-form.svelte
frontend/src/lib/features/people/ui/evacuee-list.svelte
frontend/src/lib/features/people/index.ts
frontend/src/routes/(protected)/people/+page.svelte
```

อธิบาย dependency direction:

```text
ui -> application -> data -> domain

domain:
- pure TypeScript
- Zod schemas
- document interfaces
- factories
- transitions/read models/type guards
- no PouchDB, no Svelte, no fetch

data:
- repository interface
- concrete implementation เช่น PeoplePouchRepository
- เป็น layer เดียวของ feature ที่รู้ว่า PouchDB/API อยู่ตรงไหน

application:
- TanStack Query keys
- createQuery/createMutation hooks
- live-query wiring ถ้าเป็น local-first feature

ui:
- feature-specific .svelte components
- form/list/detail components
- ไม่เรียก PouchDB หรือ remote fetch ตรง ๆ

index.ts:
- public API ของ feature
- route และ feature อื่น import จากที่นี่เท่านั้น
```

ตัวอย่างคำพูด:

```text
อย่าเริ่มจาก page แล้วค่อยยัด logic ลง component
ให้เริ่มจาก domain เพราะ business rule, schema และ factory ต้อง test ได้
จากนั้นค่อยต่อ data, application, UI และ route
```

### Step 6: Walkthrough local-first feature ด้วย `people`

ใช้ `people` เป็นตัวอย่างหลัก เพราะเดินครบ local-first path

#### 6.1 Domain layer

เปิด:

```text
frontend/src/lib/features/people/domain/people.ts
frontend/src/lib/features/people/domain/people.test.ts
```

สิ่งที่ต้องพูด:

```text
enums:
- genderSchema, stayStatusSchema, movementActionSchema, careTrackSchema

documents:
- Evacuee, Medical, Household, Movement, Screening

input schemas:
- evacueeInputSchema
- medicalInputSchema
- householdInputSchema
- movementInputSchema
- screeningInputSchema

factories:
- createEvacuee
- createMedical
- createHousehold
- createMovement
- createScreening

transitions:
- applyMovementToStay

type guards:
- isEvacuee, isMedical, isHousehold, isMovement, isScreening
```

ย้ำ:

```text
domain factory ต้อง stamp document ผ่าน makeDoc
input validation อยู่ใน Zod schema เดียวกับที่ form ใช้
append-only docs เช่น movement/screening ห้าม update/delete
snapshot เช่น current_stay เป็น UI snapshot; movement events เป็น source of truth
domain logic ต้องมี unit tests
```

#### 6.2 Data layer

เปิด:

```text
frontend/src/lib/features/people/data/people.repository.ts
frontend/src/lib/features/people/data/people.pouch.ts
```

อธิบาย:

```text
people.repository.ts:
- เป็น contract ที่ application layer depend on
- ไม่ผูกกับ PouchDB concrete implementation

people.pouch.ts:
- กำหนด SHELTER_CODE และ SHELTER_DB
- สร้าง PeoplePouchRepository
- ใช้ createRepository(namedLocalDb(dbName))
- createEvacuee เรียก domain factory แล้ว repo.put
- listEvacuees ใช้ allByType('evacuee', isEvacuee)
- updateEvacuee ใช้ touch เพื่อ bump updated_at
```

ข้อควรระวัง:

```text
repository, changes-feed live query และ startNamedSync ต้องชี้ database name เดียวกัน
ถ้าชี้คนละ db UI จะไม่ invalidate แม้ data sync แล้ว
```

#### 6.3 Application layer

เปิด:

```text
frontend/src/lib/features/people/application/queries.ts
```

อธิบาย:

```text
peopleKeys:
- query key factory

useEvacuees:
- createQuery อ่านจาก peopleRepository().listEvacuees()

useCreateEvacuee / useUpdateEvacuee:
- createMutation เขียน local PouchDB
- ไม่มี onSuccess invalidation

startPeopleLiveQuery:
- ผูก PouchDB changes feed กับ queryClient.invalidateQueries
- invalidate เฉพาะ doc type ที่เกี่ยวข้อง เช่น evacuee
```

จุดสำคัญ:

```text
local-first feature ไม่ควร rely on mutation onSuccess invalidation เป็นหลัก
เพราะ local write, remote sync และอีก tab เขียน data จะเข้ามาทาง changes feed เดียวกัน
```

#### 6.4 UI และ route composition

เปิด:

```text
frontend/src/lib/features/people/ui/evacuee-form.svelte
frontend/src/lib/features/people/ui/evacuee-list.svelte
frontend/src/routes/(protected)/people/+page.svelte
frontend/src/routes/(protected)/people/+page.ts
```

อธิบาย:

```text
evacuee-form.svelte:
- ใช้ $props พร้อม explicit type
- ใช้ Superforms + Zod schema จาก domain
- SPA: true
- onUpdate ส่ง valid form data กลับ parent ผ่าน callback prop
- ไม่เรียก mutation เอง

evacuee-list.svelte:
- รับ data ผ่าน props
- มี empty state
- ใช้ keyed each ด้วย evacuee._id

people/+page.svelte:
- เป็น orchestrator
- เรียก useEvacuees และ useCreateEvacuee
- สร้าง AuthorContext จาก SHELTER_CODE และ authStore.user
- handleRegister เรียก mutation
- toast success/error อยู่ที่ page
- จัด loading/error/success state

people/+page.ts:
- ใช้ requireAuth
```

ตัวอย่างคำพูด:

```text
Page มีหน้าที่ compose query, mutation, auth context และ feedback
Form component มีหน้าที่ validate และ emit valid input
List component มีหน้าที่ render data
เราไม่เอา PouchDB call, auth decision หรือ toast side effect ไปกระจายอยู่ในทุก component
```

### Step 7: Walkthrough service-plane/API feature ด้วย `users` และ `shelters`

บาง feature ไม่ใช่ local PouchDB feature เพราะต้องใช้ server-only authority เช่น user management และ shelter provisioning

ให้เปิด:

```text
frontend/src/lib/features/users/
frontend/src/lib/features/shelters/
frontend/src/lib/api/service.ts
frontend/src/lib/server/couch-admin.ts
frontend/src/lib/server/user-service.ts
frontend/src/routes/api/v1/users/+server.ts
frontend/src/routes/api/admin/shelter/+server.ts
```

อธิบาย pattern:

```text
data/*.api.ts:
- ใช้ serviceFetch เรียก same-origin /api/*
- ไม่เรียก CouchDB admin endpoint จาก browser

application/queries.ts:
- createQuery สำหรับ list
- createMutation สำหรับ create/delete
- mutation onSuccess invalidate query keys

server routes:
- export prerender = false
- อ่าน cookie/session แล้ว authorize
- ใช้ server-only admin client
- map error เป็น service envelope

server/couch-admin.ts:
- ใช้ COUCHDB_ADMIN_URL จาก private env
- ห้าม import เข้า client

user-service.ts:
- เป็น surface เดียวที่เขียน _users ด้วย admin credentials
```

เปรียบเทียบให้ทีมเห็น:

```text
local-first feature:
- UI -> query hook -> repository -> local PouchDB -> sync
- reactivity จาก changes feed

service-plane feature:
- UI -> query hook -> serviceFetch -> /api/* server route
- mutation onSuccess invalidate query
- server route ถือ admin secret หรือ central-only authority
```

ตัวอย่างคำพูด:

```text
ถ้า feature ต้องสร้าง shelter database, เขียน _users หรือทำอะไรที่ต้องใช้ admin credential ห้ามทำใน client
ให้ทำผ่าน server-only /api/* route หรือ service plane
```

### Step 8: Form pattern ที่ต้องทำตาม

ให้เปิด:

```text
frontend/src/lib/features/people/ui/evacuee-form.svelte
frontend/src/lib/features/users/ui/create-user-form.svelte
frontend/src/lib/features/shelters/ui/create-shelter-form.svelte
frontend/src/lib/features/login/ui/login-form.svelte
```

Pattern:

```text
schema อยู่ใน domain/
form ใช้ superForm(defaults(zod4(schema)))
ตั้ง SPA: true
ใช้ validators: zod4(schema)
ใช้ onUpdate แล้ว return ถ้า form.invalid
form component ส่ง valid input ออกผ่าน callback prop เช่น onsubmit
parent/page เป็นคนเรียก mutation และ toast
ใช้ pending/submitting disable ปุ่ม
ใช้ Form.Field, Form.Control, Form.Label, Form.FieldErrors
ใช้ snippet children({ props }) ตาม shadcn-svelte/formsnap pattern
```

ข้อห้าม:

```text
ห้าม duplicate validation rule ใน component ถ้ามี schema แล้ว
ห้ามใส่ business rule ลึก ๆ ใน markup
ห้ามเรียก remote fetch จาก form component ถ้า page/application layer ควรเป็นคนจัดการ
ห้ามใช้ +page.server.ts หรือ server action เพราะ app เป็น SPA
```

ข้อสังเกต:

```text
login/register เป็น auth-specific form จึงเรียก authStore/goto ใน component ได้
feature CRUD form เช่น EvacueeForm/CreateUserForm ควรส่ง input ให้ parent จัดการ mutation
```

### Step 9: Svelte 5 component pattern ที่ต้องชี้ให้ทีมเห็น

Pattern จาก codebase:

```text
Props:
- ใช้ $props พร้อม explicit type

Derived values:
- ใช้ $derived เช่น roles, isSA, canManageUsers, capabilities

State:
- ใช้ $state เฉพาะค่าที่ต้อง reactive เช่น noPhone

Effects:
- ใช้ $effect ให้น้อย
- ถ้าใช้ ต้องมีเหตุผล เช่น sync noPhone -> formData.phone

Events:
- ใช้ onclick / oninput
- callback props ใน codebase ใช้ onsubmit, ondelete

Lists:
- ใช้ keyed each เช่น evacuee._id, user.name, cap

Composition:
- page compose Card/Form/List
- generated shadcn components import จาก $lib/components/ui/.../index.js หรือ barrel ที่มีอยู่

Feedback:
- ใช้ toast.success, toast.error, toast.promise
- ไม่ใช้ console.log ใน committed code ยกเว้น plumbing ที่ตั้งใจไว้ เช่น sync warning
```

ตัวอย่างคำพูด:

```text
เวลา review Svelte component ให้ดูว่า component นี้กำลังทำงานเกิน role ของตัวเองหรือเปล่า
computed values ควรเป็น $derived หรือยัง
effect จำเป็นจริงไหม
each block มี key หรือไม่
และ feedback ใช้ toast แทน console.log หรือยัง
```

### Step 10: Pattern การเพิ่ม feature ใหม่

ใช้ checklist นี้ตอน walkthrough:

```text
1. อ่าน spec
2. เช็ก docs/data ถ้าแตะ data model
3. เลือก feature type: local-first, API/service หรือ UI-only
4. เริ่มจาก domain และ tests
5. ต่อ data layer
6. ต่อ application query/mutation hooks
7. ต่อ UI components
8. export ผ่าน feature index.ts
9. ต่อ route และ guard
10. ตรวจ sync/auth/security impact
11. run lint/check/test/autofixer
12. เขียน PR description ให้ track change ได้
```

### Step 11: Code review checklist สำหรับ frontend

```text
Architecture:
[ ] Route/feature อื่น import ผ่าน feature barrel เท่านั้น
[ ] Domain ไม่มี PouchDB, fetch, Svelte หรือ browser-only dependency
[ ] Data layer ซ่อน PouchDB/API detail จาก UI
[ ] Application layer มี query keys และ hooks ชัดเจน
[ ] UI component ไม่ทำ business/data access เกินหน้าที่

Local-first:
[ ] เขียน local PouchDB ก่อน ไม่ fetch remote ตรง
[ ] ใช้ makeDoc/makeDocId/touch ตาม common envelope
[ ] append-only docs ไม่ถูก update/delete
[ ] changes feed invalidate query keys ครบ
[ ] sync target มีแค่หนึ่ง active remote ต่อเวลา

Auth/security:
[ ] protected route ใช้ guard กลาง
[ ] ไม่ force logout เมื่อ sync auth หมดอายุ
[ ] admin credentials อยู่ server-only
[ ] /api/* route export prerender = false
[ ] role logic ใช้ helpers ใน $lib/auth/roles

Forms/UI:
[ ] schema อยู่ใน domain
[ ] Superforms ใช้ SPA: true และ zod4(schema)
[ ] Svelte 5 runes ใช้ถูก pattern
[ ] each block มี key
[ ] loading/error/empty states มีครบ
[ ] feedback ใช้ toast ไม่ใช้ console.log

Testing:
[ ] domain/data logic มี unit tests
[ ] PouchDB repository test ใช้ memory adapter เมื่อเหมาะสม
[ ] touched .svelte run ผ่าน svelte-autofixer
[ ] pnpm lint/check/test ผ่าน หรือระบุเหตุผลที่ยังไม่ได้รัน
```

### Step 12: Escalation examples จาก frontend pattern จริง

ตัวอย่างที่ 1:

```text
ถ้า spec ขอ field ใหม่ใน evacuee หรือ screening เช่น needs_referral
ให้ถาม Project Owner หาก business meaning ไม่ชัด
จากนั้นอัปเดต docs/data/schema.md, domain schema/factory, validate_doc_update/provisioning และ tests
```

ตัวอย่างที่ 2:

```text
ถ้า feature ใหม่ต้องอ่าน aggregate เช่น stock balance
ให้ถาม Student Lead ก่อนว่าควรใช้ CouchDB view, Mango index หรือ client read model
ถ้าต้องเพิ่ม view/index ให้แจ้ง Project Owner เพราะเป็น data-model/provisioning change
```

ตัวอย่างที่ 3:

```text
ถ้า UI ต้องเปลี่ยน flow จากหลายหน้าเป็นหน้าเดียว
ให้แจ้ง Project Owner หรือ Product Owner เพราะกระทบ user flow และ report/change tracking
```

ตัวอย่างที่ 4:

```text
ถ้า developer อยากเรียก CouchDB admin endpoint จาก browser เพื่อความง่าย
ให้หยุดทันที แล้วคุยกับ Student Lead
ถ้าจำเป็นจริงให้ทำผ่าน server-only /api/* route หรือ service plane
```

ตัวอย่างที่ 5:

```text
ถ้า sync error 401/403 แล้วอยาก redirect user ออกจาก app
ให้หยุดก่อน เพราะ current pattern คือ markNeedsReauth แล้วให้ user ทำงาน local ต่อ
ถ้าต้องเปลี่ยน behavior นี้ต้องแจ้ง Project Owner เพราะกระทบ offline-first UX
```

---

## 13. Developer Checklist

ก่อนเริ่มงาน:

```text
[ ] อ่าน spec แล้ว
[ ] เข้าใจ expected behavior แล้ว
[ ] ดู pattern เดิมใน codebase แล้ว
[ ] ถ้าเป็น frontend work ได้ดู `frontend/CONVENTIONS.md` แล้ว
[ ] ถ้าแตะข้อมูล ได้ดู `docs/data/schema.md` และ `docs/data/data-model.md` แล้ว
[ ] ตรวจแล้วว่างานนี้กระทบ CouchDB doc type, field, view, index, validation, sync หรือ retention หรือไม่
[ ] ตรวจแล้วว่าไม่ได้เพิ่ม feature/schema/abstraction เผื่ออนาคตโดยไม่มี requirement
[ ] ถ้า spec ไม่ชัด ได้เตรียมคำถามให้ Project Owner แล้ว
[ ] ถ้า technical approach ไม่ชัด ได้ถาม Student Lead แล้ว
```

ระหว่างทำงาน:

```text
[ ] ทำตาม naming และ structure convention
[ ] ตั้งชื่อ frontend variables/functions เป็น camelCase และ types/interfaces เป็น PascalCase
[ ] ใช้ YAGNI เพื่อหลีกเลี่ยงงานที่ยังไม่จำเป็น
[ ] ใช้ DRY กับ business rule หรือ logic สำคัญที่ซ้ำจริง
[ ] ไม่เปลี่ยน CouchDB schema/data model เงียบ ๆ
[ ] ไม่เปลี่ยน product flow เงียบ ๆ
[ ] ถ้ามี decision ใหม่ ได้บันทึกหรือแจ้งแล้ว
[ ] อัปเดต Zod schema, validate_doc_update, view/index หรือ provisioning ถ้ามี schema/data-model change
[ ] ตรวจ impact กับ feature อื่นแล้ว
```

ก่อนส่งงาน:

```text
[ ] ทดสอบ flow หลักแล้ว
[ ] ทดสอบ edge case สำคัญแล้ว
[ ] ระบุ CouchDB/data-model change ใน PR หรือ change note แล้ว
[ ] ระบุ UI/spec deviation แล้ว
[ ] แจ้ง Project Owner หรือ Product Owner เมื่อจำเป็นแล้ว
[ ] commit message ชัดเจน
[ ] PR description มี Summary, Reason, Impact, Database, Spec/UI และ Testing
```

---

## 14. Closing Script

สรุปสิ่งที่อยากให้ทุกคนจำจาก walkthrough วันนี้คือ

หนึ่ง ให้ทำตาม convention ของโปรเจกต์เสมอ เพราะ codebase ที่ consistent จะช่วยให้ทีม review, debug และ maintain ได้ง่ายขึ้น

สอง ใช้หลัก YAGNI เพื่อไม่สร้างของที่ยังไม่มี requirement และใช้ DRY เพื่อลด logic ซ้ำที่ทำให้เกิด bug หรือแก้ไม่ครบ

สาม database คือ source of truth ของระบบนี้ และระบบนี้ใช้ CouchDB/PouchDB แบบ offline-first ดังนั้นการแก้ doc type, field, view, index, validation หรือ sync rule ต้องทำอย่างรอบคอบ มีเหตุผล และมี record เสมอ

สี่ ถ้า spec ไม่ชัด ให้ถาม Project Owner อย่าเดาเอง โดยเฉพาะเรื่อง business rule, validation, permission, status และ expected behavior

ห้า ถ้าเป็นปัญหาด้านเทคนิค ให้ถาม Student Lead ก่อน แล้วค่อย escalate ไป Project Owner ถ้าปัญหานั้นกระทบ spec, CouchDB schema/data model, scope หรือ timeline

หก การเปลี่ยน CouchDB schema/data model สามารถทำได้ตามความเหมาะสม แต่ต้องแจ้ง Project Owner ทุกครั้ง และต้องอัปเดต `docs/data/schema.md` หรือ `docs/data/data-model.md` เมื่อเกี่ยวข้อง

เจ็ด UI สามารถปรับตามความเหมาะสมได้ แต่ถ้ากระทบ user flow, wording สำคัญ, field สำคัญ หรือ product decision ต้องแจ้ง Project Owner หรือ Product Owner

แปด ทุก change สำคัญต้อง track ได้ เพราะเราต้องใช้สำหรับการเขียนรายงาน การทำ versioning การ debug และการอธิบาย decision ย้อนหลัง

สุดท้ายนี้ ถ้าใครไม่แน่ใจว่าเรื่องที่เจอควรถามใคร ให้ถามไว้ก่อน อย่าตัดสินใจเงียบ ๆ โดยเฉพาะเรื่อง spec, CouchDB schema/data model และ user flow หลักของระบบ

หลังจากนี้เราจะเปิด Q&A แล้วค่อยเริ่มดู codebase, `docs/data/schema.md`, `docs/data/data-model.md` และ workflow การส่งงานจริงร่วมกันครับ

---

## 15. Quick Reference

```text
Spec issue:
Developer -> Project Owner

Technical issue:
Developer -> Student Lead -> Project Owner ถ้าติดจริง ๆ หรือกระทบ scope/spec/CouchDB data model

CouchDB schema/data-model change:
Developer -> Student Lead review -> แจ้ง Project Owner ทุกครั้ง

UI/product flow change:
Developer -> Project Owner หรือ Product Owner

Required tracking:
Spec change, CouchDB schema/data-model change, API contract change, UI flow change, provisioning/design-doc change, major behavior change

Engineering principles:
Use YAGNI before adding future-facing work without a requirement
Use DRY when repeated logic has the same meaning and must stay consistent
```
