import type { TriageLevel } from '../../domain/people';

type TriageCopy = { label: string; desc: string };

const th = {
	title: 'ระดับความเร่งด่วน (Triage)',
	desc: 'เลือกสีตามอาการที่ประเมินได้ — สีเหลืองและแดงระบบจะแนะนำโซนกักตัวที่จุดจัดโซน',
	levels: {
		green: { label: 'เขียว', desc: 'อาการทั่วไป / ปกติ' },
		yellow: { label: 'เหลือง', desc: 'เฝ้าระวัง / อาการปานกลาง' },
		red: { label: 'แดง', desc: 'เร่งด่วน / วิกฤต' }
	} satisfies Record<TriageLevel, TriageCopy>,
	badgePrefix: 'Triage'
};

const en: typeof th = {
	title: 'Urgency (triage)',
	desc: 'Pick a colour from the assessment — yellow and red get a quarantine zone recommendation at the zoning desk',
	levels: {
		green: { label: 'Green', desc: 'General / stable' },
		yellow: { label: 'Yellow', desc: 'Watch / moderate symptoms' },
		red: { label: 'Red', desc: 'Urgent / critical' }
	},
	badgePrefix: 'Triage'
};

export const TRIAGE_I18N = { th, en };
