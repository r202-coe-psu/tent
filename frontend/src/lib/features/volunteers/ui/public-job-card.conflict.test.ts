import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { langState } from '$lib/states/i18n.svelte';
import PublicJobCard from './public-job-card.svelte';

const job = {
	id: 'job-1',
	title: 'Central kitchen',
	shelter: 'Main shelter',
	description: 'Help prepare meals',
	shifts: [
		{
			id: 'shift-1',
			date: '2099-09-10',
			time: '08:00 - 12:00',
			quota: 10,
			confirmed: 2,
			conflict: { title: 'Registration desk', time: '2099-09-10 • 09:00 - 13:00' }
		}
	],
	tags: [],
	skills: [],
	isControlled: false
};

function renderCard(language: 'th' | 'en') {
	const previous = langState.current;
	langState.current = language;
	try {
		return render(PublicJobCard, { props: { job, onApply: () => {} } }).body;
	} finally {
		langState.current = previous;
	}
}

describe('PublicJobCard shift that clashes with a booked shift', () => {
	it('words the clash in English and leaves no Thai text when the language is EN', () => {
		const body = renderCard('en');
		expect(body).toContain('Clashes with a shift you already booked');
		expect(body).toContain('Clashes with this shift');
		expect(body).toContain('Registration desk');
		expect(body).not.toMatch(/[฀-๿]/);
	});

	it('keeps the Thai wording when the language is TH', () => {
		const body = renderCard('th');
		expect(body).toContain('เวลาชนกับกะที่จองไว้');
		expect(body).toContain('เวลาชนกับกะนี้');
		expect(body).toContain('>เวลาชน<');
	});
});
