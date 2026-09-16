import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** Compatibility: old portal path → lifted /system-management */
export const load = () => {
	redirect(307, resolve('/system-management'));
};
