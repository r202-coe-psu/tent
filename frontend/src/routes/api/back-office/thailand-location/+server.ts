import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * HOTFIX: location reads temporarily use the bundled Thailand JSON snapshot.
 * Disable writes so an administrator cannot edit CouchDB data that the active
 * read path intentionally ignores.
 */
const disabled: RequestHandler = async () =>
	json(
		{
			error: {
				code: 'LOCATION_CONFIG_DISABLED',
				message: 'ปิดปรับปรุงการจัดการข้อมูลที่อยู่ไทยชั่วคราว'
			}
		},
		{ status: 503 }
	);

export const POST: RequestHandler = disabled;
export const PUT: RequestHandler = disabled;
export const DELETE: RequestHandler = disabled;
