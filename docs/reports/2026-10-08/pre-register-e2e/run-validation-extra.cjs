const { chromium } = require('/home/jakee/Projects/tent/frontend/node_modules/@playwright/test');
const BASE='http://localhost:5173'; const S='shots2';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 }, locale: 'th-TH' });
  const fill = async (id, phone) => {
    await p.goto(BASE + '/pre-register', { waitUntil: 'networkidle' }); await p.locator('#address-no').waitFor();
    await p.locator('#address-no').fill('1/1');
    for (const [k,o] of [['province','สงขลา'],['district','หาดใหญ่'],['subdistrict','คอหงส์']]) { await p.locator('#'+k).click(); await p.waitForTimeout(400); await p.getByRole('button',{name:o,exact:true}).click(); }
    await p.locator('#member-0-first-name').fill('ทดสอบวาลิเดต'); await p.locator('#member-0-last-name').fill('คิวเอ');
    await p.locator('#member-0-card-number').fill(id); await p.locator('#member-0-gender-male').click();
    await p.locator('#member-0-phone').fill(phone); await p.locator('#member-0-phone').blur();
    const cbs = p.getByRole('checkbox', { name: /ข้าพเจ้า|รับทราบ/ }); for (let i=0;i<await cbs.count();i++) await cbs.nth(i).click();
    const respP = p.waitForResponse(r => /registrations$/.test(r.url()) && r.request().method()==='POST', { timeout: 6000 }).catch(()=>null);
    await p.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last().click();
    const res = await respP; await p.waitForTimeout(1200);
    const toasts = await p.locator('[data-sonner-toast]').allInnerTexts();
    return { posted: !!res, status: res && res.status(), body: res && (await res.text()).slice(0,250), toasts, focus: await p.evaluate(()=>document.activeElement?.id) };
  };
  let r = await fill('1234567890123', '0812345678'); console.log('BAD_ID', JSON.stringify(r));
  await p.locator('#member-0-card-number').evaluate(e=>e.scrollIntoView({block:'center'})); await p.waitForTimeout(300); await p.screenshot({ path: S+'/32-invalid-national-id.png' });
  r = await fill('', '08123'); console.log('BAD_PHONE', JSON.stringify(r));
  await p.locator('#member-0-phone').evaluate(e=>e.scrollIntoView({block:'center'})); await p.waitForTimeout(300); await p.screenshot({ path: S+'/33-invalid-phone.png' });
  await b.close();
})();
