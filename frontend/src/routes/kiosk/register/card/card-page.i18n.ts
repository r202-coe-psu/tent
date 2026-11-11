/** Walk-in card-reading page strings (route-local: a route may not reach into feature internals). */
const th = {
	pageTitle: 'เสียบบัตรประชาชน — SmartShelter Kiosk',
	wizardStep: 'อ่านบัตร',
	titleBusy: 'กำลังอ่านข้อมูลบัตร',
	title: 'เสียบบัตรประชาชน',
	pleaseWait: 'กรุณารอสักครู่',
	doNotRemove: 'อย่าดึงบัตรออก จนกว่าระบบจะอ่านเสร็จ',
	insert:
		'เสียบบัตรของผู้ที่ต้องการลงทะเบียน (หากเสียบค้างอยู่แล้ว ไม่ต้องถอด) ระบบจะอ่านข้อมูลจากชิปโดยอัตโนมัติ',
	readFailed: 'อ่านข้อมูลบัตรไม่สำเร็จ กรุณานำบัตรออกแล้วเสียบใหม่',
	cancel: 'ยกเลิก'
};

const en: typeof th = {
	pageTitle: 'Insert ID card — SmartShelter Kiosk',
	wizardStep: 'Read card',
	titleBusy: 'Reading card data',
	title: 'Insert your ID card',
	pleaseWait: 'Please wait',
	doNotRemove: 'Do not remove the card until reading is done',
	insert:
		'Insert the card of the person registering (if it is already in, leave it). The kiosk reads the chip automatically.',
	readFailed: 'Could not read the card. Please remove it and insert it again',
	cancel: 'Cancel'
};

export const KIOSK_REGISTER_CARD_I18N = { th, en };
