import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { blankUnifiedMember } from '../../domain/unified-registration';
import UnifiedRegistrationMembersSection from './unified-registration-members-section.svelte';

const newMember = () => [{ ...blankUnifiedMember(), _id: 'new-1' }];

describe('UnifiedRegistrationMembersSection — public join', () => {
	it('numbers new members after the joined family and counts everyone', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: {
				members: newMember(),
				membersSectionDesc: '',
				channel: 'public',
				isJoiningExistingHousehold: true,
				existingMemberCount: 2
			}
		});

		expect(body).toContain('สมาชิกคนที่ 3');
		// Joining: separate badges for the family's current members and the ones being added.
		expect(body).toContain('มีอยู่แล้ว 2 คน');
		expect(body).toContain('กำลังเพิ่มอีก 1 คน');
	});

	it('starts at member 1 when not joining', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: { members: newMember(), membersSectionDesc: '', channel: 'public' }
		});

		expect(body).not.toContain('สมาชิกคนที่ 3');
		expect(body).toMatch(/>\s*1 คน\s*</);
	});
});

describe('UnifiedRegistrationMembersSection — card position titles', () => {
	const twoMembers = () => [
		{ ...blankUnifiedMember(), _id: 'new-1' },
		{ ...blankUnifiedMember(), _id: 'new-2' }
	];

	it('public: folds the family position into each title', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: { members: twoMembers(), membersSectionDesc: '', channel: 'public' }
		});

		expect(body).toContain('สมาชิกคนที่ 1/2 (ผู้ติดต่อหลัก)');
		expect(body).toContain('สมาชิกคนที่ 2/2');
		expect(body).not.toMatch(/>\s*2 \/ 2\s*</);
	});

	it('public join: counts the joined family in the position', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: {
				members: newMember(),
				membersSectionDesc: '',
				channel: 'public',
				isJoiningExistingHousehold: true,
				existingMemberCount: 2
			}
		});

		expect(body).toContain('สมาชิกคนที่ 3/3');
	});

	it('onsite: keeps plain numbering without a total', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: { members: twoMembers(), membersSectionDesc: '', channel: 'onsite' }
		});

		expect(body).toContain('สมาชิกคนที่ 1 (ผู้ติดต่อหลัก)');
		expect(body).toContain('สมาชิกคนที่ 2');
		expect(body).not.toContain('สมาชิกคนที่ 2/2');
	});
});
