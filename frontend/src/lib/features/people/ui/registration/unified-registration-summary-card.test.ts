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
	it('counts the members and shows the first one as primary contact', () => {
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

		expect(result.body).toMatch(/2\s*(<!---->)?\s*คน/);
		expect(result.body).toMatch(/ผู้ติดต่อหลัก:[\s\S]*?สมชาย ใจดี/);
	});

	it('counts the joined family and keeps its head as the primary contact', () => {
		const result = render(UnifiedRegistrationSummaryCard, {
			props: {
				household: householdToUnifiedInput(null),
				members: [{ ...blankUnifiedMember(), first_name: 'โฮป', last_name: 'ใจดี' }],
				existingMemberCount: 1,
				existingHeadName: 'ชิโน ใจดี',
				activeSection: 'members',
				onNavigate: vi.fn()
			}
		});

		expect(result.body).toMatch(/2\s*(<!---->)?\s*คน/);
		expect(result.body).toContain('มีอยู่แล้ว 1 คน');
		expect(result.body).toContain('กำลังเพิ่ม 1 คน');
		// The family's head (not the new card) is shown as primary contact.
		expect(result.body).toMatch(/ผู้ติดต่อหลัก:[\s\S]*?ชิโน ใจดี/);
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

	it('uses the masked head of a publicly joined family as primary contact', () => {
		const result = render(UnifiedRegistrationSummaryCard, {
			props: {
				household: householdToUnifiedInput(null),
				members: [{ ...blankUnifiedMember(), _id: 'new-1' }],
				activeSection: 'members',
				onNavigate: vi.fn(),
				existingMemberCount: 3,
				existingHeadName: 'สมชาย ใ****'
			}
		});

		expect(result.body).toMatch(/4\s*(<!---->)?\s*คน/);
		expect(result.body).toMatch(/ผู้ติดต่อหลัก:[\s\S]*?สมชาย ใ\*\*\*\*/);
		expect(result.body).not.toContain('ยังไม่ได้ระบุชื่อ');
	});
});
