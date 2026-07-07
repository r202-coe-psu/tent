import { requireAdmin } from '$lib/guards/auth';
import type { PageLoad } from './$types';
import { error } from '@sveltejs/kit';

const VALID_ENTITIES = ['item-categories', 'item-masters', 'recipe'];

export const load = (async ({ params }) => {
	await requireAdmin();

	const { entity, mode, id } = params;

	if (!VALID_ENTITIES.includes(entity)) {
		error(404, 'Page Not Found (Entity is invalid)');
	}

	if (mode !== 'create' && mode !== 'edit') {
		error(404, 'Page Not Found (Mode is invalid)');
	}

	if (mode === 'edit' && !id) {
		error(400, 'Need ID For Edit');
	}

	return {
		entity: entity as 'item-categories' | 'item-masters' | 'recipe' | 'recipes',
		mode: mode as 'create' | 'edit',
		id: id ?? ''
	};
}) satisfies PageLoad;
