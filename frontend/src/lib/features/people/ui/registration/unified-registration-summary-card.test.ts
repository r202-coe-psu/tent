import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import {
	blankUnifiedMember,
	householdToUnifiedInput,
	type UnifiedMemberWithMeta
} from '../../domain/unified-registration';
import { langState } from '$lib/states/i18n.svelte';
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

	it('counts the joined family and keeps its head as the primary contact', () => {
		const result = render(UnifiedRegistrationSummaryCard, {
			props: {
				household: householdToUnifiedInput(null),
				members: [{ ...blankUnifiedMember(), first_name: 'โฮป', last_name: 'ใจดี' }],
				existingMembers: [
					{ _id: 'evacuee:a', first_name: 'ชิโน', last_name: 'ใจดี', gender: 'male' }
				],
				existingHeadName: 'ชิโน ใจดี',
				activeSection: 'members',
				onNavigate: vi.fn()
			}
		});

		expect(result.body).toContain('2 คน');
		expect(result.body).toContain('สมาชิกเดิม 1 · มาใหม่ 1');
		// The family's head (not the new card) is shown as primary contact.
		expect(result.body).toMatch(/ผู้ติดต่อหลัก:[\s\S]*?ชิโน ใจดี/);
		expect(result.body).toContain('โฮป ใจดี');
	});

	it('renders in English when the page language is English', () => {
		const previous = langState.current;
		langState.current = 'en';
		try {
			const result = render(UnifiedRegistrationSummaryCard, {
				props: {
					household: householdToUnifiedInput(null),
					members: [{ ...blankUnifiedMember(), first_name: 'Somchai', last_name: 'Jaidee' }],
					activeSection: 'members',
					onNavigate: vi.fn()
				}
			});
			expect(result.body).toContain('Registration summary');
			expect(result.body).toContain('1 person');
			expect(result.body).toContain('No shelter selected');
			expect(result.body).not.toContain('สรุปข้อมูลการลงทะเบียน');
		} finally {
			langState.current = previous;
		}
	});
});
