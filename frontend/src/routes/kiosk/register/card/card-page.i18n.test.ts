import { describe, expect, it } from 'vitest';
import { KIOSK_REGISTER_CARD_I18N } from './card-page.i18n';
import { KIOSK_REGISTER_FACE_I18N } from '../face/face-page.i18n';

const THAI = /[฀-๿]/;

describe('walk-in route dictionaries', () => {
	it.each([
		['card', KIOSK_REGISTER_CARD_I18N],
		['face', KIOSK_REGISTER_FACE_I18N]
	])('%s page has the same keys in both languages and no Thai in English', (_name, dict) => {
		expect(Object.keys(dict.en).sort()).toEqual(Object.keys(dict.th).sort());
		expect(Object.values(dict.en).filter((text) => THAI.test(text))).toEqual([]);
	});
});
