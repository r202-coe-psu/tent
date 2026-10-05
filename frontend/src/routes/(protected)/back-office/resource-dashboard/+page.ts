import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = async () => {
	redirect(308, resolve('/back-office/supply?tab=sphere'));
};
