import { describe, expect, it } from 'vitest';
import { incomingLinkAction } from './desk-link-gate';

describe('incomingLinkAction', () => {
	it('applies a same-mode link even with a draft', () => {
		expect(incomingLinkAction({ currentMode: 'food', linkMode: 'food', hasDraft: true })).toBe(
			'apply'
		);
	});

	it('applies a mode-changing link when there is no draft', () => {
		expect(incomingLinkAction({ currentMode: 'food', linkMode: 'supplies', hasDraft: false })).toBe(
			'apply'
		);
	});

	it('asks to confirm a mode-changing link while a draft exists', () => {
		expect(incomingLinkAction({ currentMode: 'food', linkMode: 'supplies', hasDraft: true })).toBe(
			'confirm'
		);
		expect(incomingLinkAction({ currentMode: 'supplies', linkMode: 'food', hasDraft: true })).toBe(
			'confirm'
		);
	});

	it('applies a same-mode link with no draft', () => {
		expect(
			incomingLinkAction({ currentMode: 'supplies', linkMode: 'supplies', hasDraft: false })
		).toBe('apply');
	});
});
