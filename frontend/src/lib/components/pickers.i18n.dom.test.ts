// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { langState } from '$lib/states/i18n.svelte';
import TimePicker from './time-picker.svelte';
import DatePicker from './date-picker.svelte';

let instance: ReturnType<typeof mount> | null = null;

function show(component: typeof TimePicker | typeof DatePicker, language: 'th' | 'en') {
	langState.current = language;
	instance = mount(component as typeof TimePicker, { target: document.body, props: {} });
	flushSync();
	return document.body.textContent ?? '';
}

afterEach(() => {
	if (instance) unmount(instance);
	instance = null;
	document.body.innerHTML = '';
	langState.current = 'th';
});

describe('TimePicker', () => {
	it('shows its default placeholder in the selected language', () => {
		expect(show(TimePicker, 'en')).toContain('Select time');
	});

	it('keeps the Thai default placeholder when the language is TH', () => {
		expect(show(TimePicker, 'th')).toContain('เลือกเวลา');
	});

	it('labels the hour and minute dropdowns in English when the language is EN', () => {
		show(TimePicker, 'en');
		document.body.querySelector('button')!.click();
		flushSync();
		const text = document.body.textContent ?? '';
		expect(text).toContain('Hour');
		expect(text).toContain('Minute');
		expect(text).not.toContain('ชั่วโมง');
	});

	it('labels the hour and minute dropdowns in Thai when the language is TH', () => {
		show(TimePicker, 'th');
		document.body.querySelector('button')!.click();
		flushSync();
		const text = document.body.textContent ?? '';
		expect(text).toContain('ชั่วโมง');
		expect(text).toContain('นาที');
	});
});

describe('DatePicker', () => {
	it('shows its default placeholder in the selected language', () => {
		expect(show(DatePicker, 'en')).toContain('Select date');
	});

	it('keeps the Thai default placeholder when the language is TH', () => {
		expect(show(DatePicker, 'th')).toContain('เลือกวันที่');
	});
});
