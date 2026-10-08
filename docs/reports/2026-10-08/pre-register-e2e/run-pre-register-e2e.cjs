const { chromium } = require('/home/jakee/Projects/tent/frontend/node_modules/@playwright/test');
const fs = require('fs');
const SHOTS = process.argv[2] || 'shots';
require('fs').mkdirSync(SHOTS,{recursive:true});
const BASE = 'http://localhost:5173';
const RUN = Date.now().toString().slice(-5);
function thaiId(prefix) { const d = prefix.split('').map(Number); let s=0; for (let i=0;i<12;i++) s+=d[i]*(13-i); return prefix + ((11 - s%11)%10); }
const ID1 = thaiId('19901' + RUN + '12'); const ID2 = thaiId('29901' + RUN + '34');
const results = []; const net = []; const errs = [];
let n = 0;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
  const p = await ctx.newPage();
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type()==='error') errs.push('console.error: '+m.text().slice(0,300)); });
  p.on('response', async r => { const u = r.url(); if (u.includes('/api/') && r.request().method() !== 'GET') { let body=''; try { body = (await r.text()).slice(0,600);} catch{} net.push({ method: r.request().method(), url: u.replace(BASE,''), status: r.status(), req: (r.request().postData()||'').slice(0,2500), body }); } });
  const shot = async (name, opts={}) => { n++; const f = `${String(n).padStart(2,'0')}-${name}.png`; if (opts.el) await opts.el.screenshot({ path: SHOTS+'/'+f }); else await p.screenshot({ path: SHOTS+'/'+f, fullPage: !!opts.full }); return f; };
  const step = async (id, title, fn) => { const r = { id, title, status: 'PASS', notes: [], shots: [] }; try { await fn(r); } catch (e) { r.status = 'FAIL'; r.notes.push('ERROR: ' + e.message.split('\n')[0]); try { r.shots.push(await shot(id+'-fail')); } catch{} } results.push(r); console.log(r.status, id, title, r.notes.join(' | ')); };
  const ackConsent = async () => { const cbs = p.getByRole('checkbox', { name: /ข้าพเจ้า|รับทราบ/ }); const c = await cbs.count(); for (let i=0;i<c;i++){ const a=cbs.nth(i); if ((await a.getAttribute('aria-checked'))!=='true') await a.click(); } return c; };
  const center = async (loc) => { await loc.evaluate(e => e.scrollIntoView({ block: 'center' })); await p.waitForTimeout(300); };

  await step('TC01', 'เปิดหน้าแรก (Landing)', async r => {
    const t0 = Date.now(); await p.goto(BASE + '/', { waitUntil: 'networkidle' }); r.notes.push(`load ${Date.now()-t0} ms`);
    r.shots.push(await shot('home-hero'));
    r.shots.push(await shot('home-full', { full: true }));
    const cta = p.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' });
    if (!(await cta.isVisible())) throw new Error('ไม่พบปุ่ม CTA ลงทะเบียนล่วงหน้า');
    const navCount = await p.locator('a[href="/pre-register"]').count(); r.notes.push(`ลิงก์ไป /pre-register บนหน้าแรก ${navCount} จุด`);
  });

  await step('TC02', 'กดปุ่ม CTA “ลงทะเบียนผู้ประสบภัยล่วงหน้า” → หน้า /pre-register', async r => {
    await p.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' }).hover(); r.shots.push(await shot('home-cta-hover'));
    await p.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' }).click();
    await p.waitForURL('**/pre-register'); await p.locator('#address-no').waitFor({ timeout: 15000 }); await p.waitForTimeout(800);
    r.notes.push('URL: ' + p.url().replace(BASE,'')); r.notes.push('title: ' + await p.title());
    r.shots.push(await shot('pre-register-top'));
    r.shots.push(await shot('pre-register-full', { full: true }));
  });

  await step('TC03', 'ตัวเลือกศูนย์พักพิง (dropdown)', async r => {
    const trig = p.getByRole('button', { name: /ไม่ระบุศูนย์พักพิง|เลือกศูนย์พักพิง/ }).first();
    await trig.click(); await p.waitForTimeout(400);
    const opts = await p.getByRole('option').allInnerTexts(); r.notes.push('ตัวเลือก: ' + opts.map(s=>s.replace(/\s+/g,' ').trim()).join(' / '));
    r.shots.push(await shot('shelter-dropdown'));
    await p.getByRole('option', { name: /ไม่ระบุศูนย์พักพิง/ }).click();
  });

  await step('TC04', 'กดยืนยันขณะฟอร์มว่าง → แสดง validation', async r => {
    let posted = false; const h = req => { if (req.method()==='POST' && /registrations/.test(req.url())) posted = true; }; p.on('request', h);
    const sub = p.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last();
    r.notes.push('ปุ่มยืนยันก่อนติ๊กยอมรับเงื่อนไข disabled = ' + await sub.isDisabled());
    await center(sub); r.shots.push(await shot('submit-disabled-before-consent'));
    await ackConsent(); r.notes.push('ติ๊กยอมรับเงื่อนไขแล้ว → disabled = ' + await sub.isDisabled());
    await sub.click(); await p.waitForTimeout(1200);
    p.off('request', h);
    const focused = await p.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.tagName));
    r.notes.push('focus หลัง submit: ' + focused); r.notes.push('ส่ง request ออกไป: ' + posted);
    r.shots.push(await shot('empty-submit-viewport'));
    const alerts = await p.locator('[role=alert], .text-destructive').allInnerTexts();
    r.notes.push('ข้อความ error: ' + [...new Set(alerts.map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,12).join(' ; '));
    r.shots.push(await shot('empty-submit-full', { full: true }));
    if (posted) throw new Error('ฟอร์มว่างแต่ส่ง request ออกไป');
  });

  await step('TC05', 'กรอกที่อยู่ + cascade จังหวัด/อำเภอ/ตำบล (ข้อมูลจริง)', async r => {
    await center(p.locator('#housing-type')); 
    await p.locator('#housing-type').click(); await p.waitForTimeout(300);
    r.notes.push('ประเภทที่อยู่อาศัย: ' + (await p.getByRole('option').allInnerTexts()).map(s=>s.trim()).join(' / '));
    r.shots.push(await shot('housing-type-options'));
    await p.keyboard.press('Escape');
    await p.locator('#residence-landmark').fill('ใกล้ตลาดคอหงส์');
    await p.locator('#address-no').fill('99/9');
    await p.locator('#village-no').fill('หมู่ 3 ถ.กาญจนวนิช');
    await p.locator('#province').click(); await p.waitForTimeout(500);
    r.shots.push(await shot('province-picker'));
    const search = p.locator('input[placeholder*="ค้นหา"]:visible').last();
    if (await search.count()) await search.fill('สงขลา');
    await p.getByRole('button', { name: 'สงขลา', exact: true }).click();
    await p.locator('#district').click(); await p.waitForTimeout(500);
    await p.getByRole('button', { name: 'หาดใหญ่', exact: true }).click();
    await p.locator('#subdistrict').click(); await p.waitForTimeout(500);
    r.shots.push(await shot('subdistrict-picker'));
    await p.getByRole('button', { name: 'คอหงส์', exact: true }).click(); await p.waitForTimeout(400);
    const zip = await p.locator('#postal_code').inputValue(); r.notes.push('รหัสไปรษณีย์ auto-fill: ' + zip);
    await center(p.locator('#address-no'));
    r.shots.push(await shot('address-filled'));
    if (zip !== '90110') throw new Error('รหัสไปรษณีย์ไม่ใช่ 90110: ' + zip);
  });

  await step('TC06', 'Validation: เลขบัตรประชาชนผิด checksum และเบอร์โทรไม่ครบ', async r => {
    await p.locator('#member-0-first-name').fill('ทดสอบคิวเอ');
    await p.locator('#member-0-card-number').fill('1234567890123'); await p.locator('#member-0-card-number').blur();
    await p.locator('#member-0-phone').fill('08123'); await p.locator('#member-0-phone').blur();
    await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click(); await p.waitForTimeout(1000);
    const focused = await p.evaluate(() => document.activeElement && document.activeElement.id); r.notes.push('focus: ' + focused);
    await center(p.locator('#member-0-card-number'));
    r.shots.push(await shot('invalid-id-phone'));
    const errsTxt = await p.locator('[role=alert], .text-destructive').allInnerTexts();
    r.notes.push('ข้อความ: ' + [...new Set(errsTxt.map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean))].slice(0,10).join(' ; '));
  });

  await step('TC07', 'กรอกข้อมูลผู้ติดต่อหลัก (ถูกต้อง)', async r => {
    await p.locator('#member-0-first-name').fill('ทดสอบคิวเอ');
    await p.locator('#member-0-last-name').fill('พรีรีจิส' + RUN);
    await p.locator('#member-0-nickname').fill('คิวเอ');
    await p.locator('#member-0-card-number').fill(ID1);
    await p.locator('#member-0-birth-year').fill('2530'); await p.locator('#member-0-birth-year').blur(); await p.waitForTimeout(300);
    r.notes.push('อายุคำนวณอัตโนมัติจากปีเกิด 2530: ' + await p.locator('#member-0-age').inputValue());
    await p.locator('#member-0-gender-male').click();
    await p.locator('#member-0-phone').fill('0812345' + RUN.slice(-3));
    r.notes.push('เลขบัตร (checksum ถูกต้อง) ' + ID1);
    await p.getByRole('button', { name: 'ผู้ติดต่อฉุกเฉิน' }).click(); await p.waitForTimeout(300);
    await p.locator('#emergency-name').fill('สมศรี ทดสอบ'); await p.locator('#emergency-phone').fill('0899999999'); await p.locator('#emergency-relation').fill('มารดา');
    await center(p.locator('#member-0-first-name'));
    r.shots.push(await shot('head-member-filled'));
    await center(p.locator('#emergency-name'));
    r.shots.push(await shot('emergency-contact'));
  });

  await step('TC08', 'เพิ่มสมาชิกคนที่ 2 + เลือกกลุ่มเปราะบาง', async r => {
    await p.getByRole('button', { name: 'เพิ่มสมาชิก' }).first().click(); await p.waitForTimeout(500);
    await p.locator('#member-1-first-name').waitFor();
    await p.locator('#member-1-first-name').fill('ยายทดสอบ');
    await p.locator('#member-1-last-name').fill('พรีรีจิส' + RUN);
    await p.locator('#member-1-card-number').fill(ID2).catch(()=>{});
    await p.locator('#member-1-birth-year').fill('2485').catch(()=>{}); await p.locator('#member-1-birth-year').blur().catch(()=>{});
    await p.locator('#member-1-gender-female').click();
    r.notes.push('เพศสมาชิก 2 aria-checked=' + await p.locator('#member-1-gender-female').getAttribute('aria-checked'));
    const vgBtn = p.getByRole('region', { name: 'สมาชิก 2' }).getByRole('button', { name: 'กลุ่มเปราะบาง' });
    if (await vgBtn.count()) { await vgBtn.click(); await p.waitForTimeout(300); }
    await p.locator('#vg-1-elderly_dependent').click(); await p.locator('#vg-1-wheelchair').click().catch(()=>{});
    await center(p.locator('#member-1-first-name'));
    r.shots.push(await shot('member2-filled'));
    await center(p.locator('#vg-1-elderly_dependent'));
    r.shots.push(await shot('member2-vulnerable'));
    r.notes.push('Live summary: ' + (await p.locator('aside').first().innerText()).replace(/\s+/g,' ').slice(0,250));
  });

  await step('TC09', 'เพิ่มสัตว์เลี้ยง (แมว 1 ตัว)', async r => {
    const petHdr = p.getByRole('button', { name: /สัตว์เลี้ยง ไม่จำเป็น/ });
    await center(petHdr); await petHdr.click(); await p.waitForTimeout(400);
    await p.getByRole('button', { name: 'เพิ่มแมว' }).click(); await p.waitForTimeout(400);
    const nameIn = p.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้');
    await nameIn.fill('ส้มจี๊ด');
    await p.getByPlaceholder(/มีโรคประจำตัว|สายพันธุ์/).fill('แมวไทย ฉีดวัคซีนแล้ว').catch(()=>{});
    await p.getByText('มีกรง / สายจูง / ตะกร้า').click().catch(()=>{});
    await center(nameIn);
    r.shots.push(await shot('pet-added'));
  });

  await step('TC10', 'ยอมรับเงื่อนไข + ตรวจสรุป (Live Summary)', async r => {
    const cnt = await ackConsent(); r.notes.push('checkbox เงื่อนไขที่พบ: ' + cnt);
    await center(p.locator('#unassigned-disclaimer-ack'));
    r.shots.push(await shot('consent-checked'));
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
    const aside = p.locator('aside').first(); if (await aside.count()) r.shots.push(await shot('live-summary', { el: aside }));
  });

  let ticketCode = '';
  await step('TC11', 'กดยืนยันการลงทะเบียน → ได้ใบลงทะเบียน/QR (เขียนข้อมูลจริง)', async r => {
    const t0 = Date.now();
    const respP = p.waitForResponse(res => /registrations/.test(res.url()) && res.request().method()==='POST', { timeout: 20000 });
    await p.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
    const res = await respP; r.notes.push(`POST ${res.url().replace(BASE,'')} → ${res.status()} (${Date.now()-t0} ms)`);
    const body = await res.json().catch(()=>({})); r.notes.push('response: ' + JSON.stringify(body).slice(0,400));
    ticketCode = body.code || body.registration_code || body.ticket_code || '';
    await p.waitForTimeout(2500);
    r.shots.push(await shot('after-submit'));
    r.shots.push(await shot('ticket-full', { full: true }));
    const qr = await p.locator('img[alt*="QR"], canvas, svg[aria-label*="QR"]').count(); r.notes.push('QR elements: ' + qr);
    if (res.status() >= 400) throw new Error('submit ไม่สำเร็จ HTTP ' + res.status());
  });

  await step('TC12', 'แท็บ “ใบลงทะเบียนของฉัน” (เก็บใน localStorage)', async r => {
    const ls = await p.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter(k=>/ticket|booking|regist/i.test(k)).map(k=>[k, localStorage.getItem(k).slice(0,300)])));
    r.notes.push('localStorage: ' + JSON.stringify(ls).slice(0,400));
    await p.evaluate(() => window.scrollTo(0,0));
    await p.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click(); await p.waitForTimeout(1500);
    r.shots.push(await shot('my-tickets'));
  });

  await step('TC13', 'รีโหลดหน้า → ใบลงทะเบียนยังอยู่', async r => {
    await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
    r.shots.push(await shot('reload-top'));
    await p.getByRole('button', { name: /ใบลงทะเบียนของฉัน/ }).click(); await p.waitForTimeout(1500);
    r.shots.push(await shot('reload-my-tickets'));
    const ls2 = await p.evaluate(() => Object.keys(localStorage).filter(k=>/ticket|booking|regist/i.test(k)).map(k=>k+'='+localStorage.getItem(k).slice(0,200)));
    r.notes.push('localStorage หลังรีโหลด: ' + JSON.stringify(ls2));
    const txt = await p.locator('main, body').first().innerText(); r.notes.push('พบชื่อผู้ลงทะเบียนในประวัติ: ' + txt.includes('ทดสอบคิวเอ'));
  });

  await step('TC14', 'ลงทะเบียนซ้ำด้วยเลขบัตรเดิม (duplicate)', async r => {
    await p.goto(BASE + '/pre-register', { waitUntil: 'networkidle' }); await p.locator('#address-no').waitFor();
    await p.locator('#address-no').fill('99/9');
    for (const [id,o] of [['province','สงขลา'],['district','หาดใหญ่'],['subdistrict','คอหงส์']]) { await p.locator('#'+id).click(); await p.waitForTimeout(400); await p.getByRole('button',{name:o,exact:true}).click(); }
    await p.locator('#member-0-first-name').fill('ทดสอบคิวเอ'); await p.locator('#member-0-last-name').fill('พรีรีจิส' + RUN);
    await p.locator('#member-0-card-number').fill(ID1); await p.locator('#member-0-gender-male').click();
    await p.locator('#member-0-phone').fill('0812345' + RUN.slice(-3));
    await ackConsent();
    const respP = p.waitForResponse(res => /registrations/.test(res.url()) && res.request().method()==='POST', { timeout: 20000 }).catch(()=>null);
    await p.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
    const res = await respP; if (res) { r.notes.push(`POST → ${res.status()}`); r.notes.push('response: ' + (await res.text()).slice(0,300)); } else r.notes.push('ไม่มี POST ออกไป');
    await p.waitForTimeout(1500);
    r.shots.push(await shot('duplicate-result'));
    const toasts = await p.locator('[data-sonner-toast]').allInnerTexts(); r.notes.push('toast: ' + toasts.join(' | '));
  });

  await step('TC15', 'มุมมองมือถือ (390×844)', async r => {
    const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'th-TH' });
    const mp = await m.newPage(); await mp.goto(BASE + '/', { waitUntil: 'networkidle' });
    n++; await mp.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-mobile-home.png` }); r.shots.push(`${String(n).padStart(2,'0')}-mobile-home.png`);
    await mp.getByRole('link', { name: 'ลงทะเบียนผู้ประสบภัยล่วงหน้า' }).click(); await mp.waitForURL('**/pre-register'); await mp.locator('#address-no').waitFor(); await mp.waitForTimeout(800);
    n++; await mp.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-mobile-pre-register.png` }); r.shots.push(`${String(n).padStart(2,'0')}-mobile-pre-register.png`);
    await mp.locator('#member-0-first-name').evaluate(e => e.scrollIntoView({ block: 'center' })); await mp.waitForTimeout(300);
    n++; await mp.screenshot({ path: `${SHOTS}/${String(n).padStart(2,'0')}-mobile-member.png` }); r.shots.push(`${String(n).padStart(2,'0')}-mobile-member.png`);
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); r.notes.push('horizontal overflow: ' + ov + 'px');
    if (ov > 2) throw new Error('มี horizontal scroll ' + ov + 'px');
    await m.close();
  });

  await step('TC16', 'สลับภาษา EN', async r => {
    await p.goto(BASE + '/pre-register', { waitUntil: 'networkidle' }); await p.locator('#address-no').waitFor();
    await p.getByRole('button', { name: 'EN' }).first().click(); await p.waitForTimeout(800);
    r.shots.push(await shot('english'));
    r.notes.push('H1: ' + await p.locator('h1').first().innerText());
    await p.getByRole('button', { name: /^TH$/ }).first().click().catch(()=>{});
  });

  fs.writeFileSync(SHOTS+'/results.json', JSON.stringify({ RUN, ID1, ID2, ticketCode, results, net, errs }, null, 2));
  await b.close();
})();
