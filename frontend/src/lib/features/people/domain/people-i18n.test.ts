import { describe, expect, it } from 'vitest';
import { ConflictError } from '$lib/utils/errors';
import {
	EWAR_SYMPTOM_GROUPS,
	STATUS_LABELS,
	ewarSymptomGroupsByLanguage,
	ewarSymptomLabel,
	genderLabel,
	movementConflictMessage,
	movementReasonLabel,
	peopleLabels,
	peopleLabelsByLanguage,
	petSpeciesLabel
} from './people';

const sortedKeys = (o: object) => Object.keys(o).sort();

describe('people label sets by language', () => {
	it('returns the original Thai maps for th', () => {
		expect(peopleLabels('th').stayStatus).toBe(STATUS_LABELS);
		expect(peopleLabels().stayStatus).toBe(STATUS_LABELS);
		expect(peopleLabels('th').gender.male).toBe('ชาย');
		expect(peopleLabels('th').petSpecies.other).toBe('อื่นๆ');
		expect(peopleLabels('th').shelterClosedReason).toBe('ศูนย์ปิด');
	});

	it('returns English copy for en', () => {
		const en = peopleLabels('en');
		expect(en.stayStatus.checked_out).toBe('Checked out');
		expect(en.stayStatus.temporary_leave).toBe('On temporary leave');
		expect(en.gender.female).toBe('Female');
		expect(en.gender.unspecified).toBe('Not specified');
		expect(en.petSpecies.dog).toBe('Dog');
		expect(en.shelterClosedReason).toBe('Shelter closed');
	});

	it('has exactly the Thai keys in every English map', () => {
		const { th, en } = peopleLabelsByLanguage;
		expect(sortedKeys(en.stayStatus)).toEqual(sortedKeys(th.stayStatus));
		expect(sortedKeys(en.gender)).toEqual(sortedKeys(th.gender));
		expect(sortedKeys(en.petSpecies)).toEqual(sortedKeys(th.petSpecies));
		expect(Object.values(en.stayStatus).every((v) => !/[฀-๿]/.test(v))).toBe(true);
	});
});

describe('label helpers take an optional language', () => {
	it('genderLabel treats null and legacy other as unspecified', () => {
		expect(genderLabel('male')).toBe('ชาย');
		expect(genderLabel(null, 'th')).toBe('ไม่ระบุ');
		expect(genderLabel('male', 'en')).toBe('Male');
		expect(genderLabel('other', 'en')).toBe('Not specified');
		expect(genderLabel(undefined, 'en')).toBe('Not specified');
	});

	it('petSpeciesLabel', () => {
		expect(petSpeciesLabel('cat')).toBe('แมว');
		expect(petSpeciesLabel('cat', 'en')).toBe('Cat');
	});

	it('movementReasonLabel maps the shelter-close code and passes free text through', () => {
		expect(movementReasonLabel('shelter_closed')).toBe('ศูนย์ปิด');
		expect(movementReasonLabel('shelter_closed', 'en')).toBe('Shelter closed');
		expect(movementReasonLabel('went home', 'en')).toBe('went home');
		expect(movementReasonLabel(null, 'en')).toBe('');
	});

	it('movementConflictMessage', () => {
		const conflict = new ConflictError('x');
		expect(movementConflictMessage(conflict)).toBe(
			'ข้อมูลถูกแก้ไขจากที่อื่นแล้ว กรุณาโหลดข้อมูลใหม่แล้วลองอีกครั้ง'
		);
		expect(movementConflictMessage(conflict, 'en')).toBe(
			'This record was changed elsewhere. Reload and try again.'
		);
		expect(movementConflictMessage(new Error('boom'), 'en')).toBe('boom');
		expect(movementConflictMessage('weird', 'en')).toBe('Could not save');
		expect(movementConflictMessage('weird')).toBe('บันทึกไม่สำเร็จ');
	});
});

describe('EWAR symptom groups by language', () => {
	it('serves the original Thai groups for th', () => {
		expect(ewarSymptomGroupsByLanguage.th).toBe(EWAR_SYMPTOM_GROUPS);
	});

	it('mirrors the Thai group and symptom ids, order and emoji in en', () => {
		const th = ewarSymptomGroupsByLanguage.th;
		const en = ewarSymptomGroupsByLanguage.en;
		expect(en.length).toBe(th.length);
		en.forEach((group, i) => {
			expect(group.symptoms.map((s) => [s.id, s.emoji])).toEqual(
				th[i].symptoms.map((s) => [s.id, s.emoji])
			);
		});
	});

	it('uses English titles, labels and clinical sublabels', () => {
		const en = ewarSymptomGroupsByLanguage.en;
		expect(en[1].title).toBe('Respiratory symptoms');
		const diarrhoea = en.flatMap((g) => g.symptoms).find((s) => s.id === 'acute_watery_diarrhea');
		expect(diarrhoea?.label).toBe('Watery diarrhoea (suspected cholera)');
		expect(diarrhoea?.sublabel).toBe('Acute watery diarrhoea / Cholera');
		const thaiText = JSON.stringify(en).match(/[฀-๿]/);
		expect(thaiText).toBeNull();
	});

	it('ewarSymptomLabel resolves per language and falls back to the id', () => {
		expect(ewarSymptomLabel('dengue')).toBe('ไข้เลือดออก');
		expect(ewarSymptomLabel('dengue', 'en')).toBe('Dengue fever');
		expect(ewarSymptomLabel('unknown_id', 'en')).toBe('unknown_id');
	});
});
