// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { firstInvalidField, focusTargetFor } from './registration-focus';

function mount(html: string): HTMLElement {
	document.body.innerHTML = html;
	return document.body;
}

describe('firstInvalidField', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('returns the first flagged field in DOM order', () => {
		const root = mount(`
			<input id="ok" />
			<input id="first" aria-invalid="true" />
			<input id="second" aria-invalid="true" />
			<input id="valid" aria-invalid="false" />
		`);
		expect(firstInvalidField(root)?.id).toBe('first');
	});

	it('skips disabled controls so the jump lands on something focusable', () => {
		const root = mount(`
			<button id="district" aria-invalid="true" disabled></button>
			<button id="province" aria-invalid="true"></button>
		`);
		expect(firstInvalidField(root)?.id).toBe('province');
	});

	it('returns null when nothing is flagged or there is no root', () => {
		expect(firstInvalidField(mount('<input />'))).toBeNull();
		expect(firstInvalidField(null)).toBeNull();
	});
});

describe('focusTargetFor', () => {
	it('keeps native controls as the target', () => {
		mount('<input id="name" aria-invalid="true" />');
		const input = document.getElementById('name')!;
		expect(focusTargetFor(input)).toBe(input);
	});

	it('moves into the first radio of an invalid radio group', () => {
		mount(`
			<div id="group" role="radiogroup" aria-invalid="true">
				<button role="radio" id="male" tabindex="-1"></button>
				<button role="radio" id="female" tabindex="-1"></button>
			</div>
		`);
		const group = document.getElementById('group')!;
		const target = focusTargetFor(group);
		expect(target.id).toBe('male');
		target.focus();
		expect(group.contains(document.activeElement)).toBe(true);
	});

	it('falls back to the wrapper when it holds nothing focusable', () => {
		mount('<div id="empty" aria-invalid="true"></div>');
		const empty = document.getElementById('empty')!;
		expect(focusTargetFor(empty)).toBe(empty);
	});
});
