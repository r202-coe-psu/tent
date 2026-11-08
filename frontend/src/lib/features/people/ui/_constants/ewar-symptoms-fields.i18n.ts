const th = {
	temperatureLabel: 'อุณหภูมิร่างกาย (°C)',
	temperaturePlaceholder: 'เช่น 36.8',
	temperatureNotNumber: 'กรุณากรอกอุณหภูมิเป็นตัวเลข',
	temperatureOutOfRange: 'อุณหภูมิต้องอยู่ระหว่าง 30 ถึง 45 °C',
	checklistTitle: 'อาการเฝ้าระวัง (EWAR Symptoms Checklist)',
	selectedCount: (n: number) => `เลือกแล้ว ${n} รายการ`
};

const en: typeof th = {
	temperatureLabel: 'Body temperature (°C)',
	temperaturePlaceholder: 'e.g. 36.8',
	temperatureNotNumber: 'Enter the temperature as a number',
	temperatureOutOfRange: 'Temperature must be between 30 and 45 °C',
	checklistTitle: 'EWAR symptoms checklist',
	selectedCount: (n) => `${n} selected`
};

export const EWAR_SYMPTOMS_FIELDS_I18N = { th, en };
