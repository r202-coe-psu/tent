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
		expect(body).toMatch(/>\s*3 คน\s*</);
	});

	it('starts at member 1 when not joining', () => {
		const { body } = render(UnifiedRegistrationMembersSection, {
			props: { members: newMember(), membersSectionDesc: '', channel: 'public' }
		});

		expect(body).not.toContain('สมาชิกคนที่ 3');
		expect(body).toMatch(/>\s*1 คน\s*</);
	});
});
