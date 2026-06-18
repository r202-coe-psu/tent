import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

export const load = async () => {
	redirect(307, resolve('/back-office/evacuee-management'));
};
