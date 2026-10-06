import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import {
	blankUnifiedMember,
	householdToUnifiedInput,
	type UnifiedMemberWithMeta
} from '../../domain/unified-registration';
import UnifiedRegistrationSummaryCard from './unified-registration-summary-card.svelte';

describe('UnifiedRegistrationSummaryCard', () => {
	it('renders every member name in the live household summary', () => {
		const members: UnifiedMemberWithMeta[] = [
			{
				...blankUnifiedMember(),
				_id: 'member-1',
				first_name: 'สมชาย',
				last_name: 'ใจดี'
			},
			{
				...blankUnifiedMember(),
				_id: 'member-2',
				first_name: '',
				last_name: ''
			}
		];

		const result = render(UnifiedRegistrationSummaryCard, {
			props: {
				household: householdToUnifiedInput(null),
				members,
				activeSection: 'members',
				onNavigate: vi.fn()
			}
		});

		expect(result.body).toContain('2 คน');
		expect(result.body).toContain('สมชาย ใจดี');
		expect(result.body).toContain('สมาชิกคนที่ 2');
	});
});
