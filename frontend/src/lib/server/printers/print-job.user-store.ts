import { userRaw } from '$lib/server/couch-as-user';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { printingDbName } from '$lib/features/printers/domain/printing-db';
import { PrintDependencyError } from './device-credentials';
import type { PrintJobCreator, PrintJobReader } from './print-jobs.server';
import type { PrintJobDoc } from './print-queue.server';

/**
 * Print-job access as the logged-in staff member (their `AuthSession` cookie), against the shelter
 * DB `printing_{code}`. `_security` and `_design/print_access` decide what they may read/write, so
 * a `CouchUserError` (401/403) is NOT caught here — routes map it.
 */
export function userJobStore(
	cookieHeader: string | null,
	shelterCode: string
): PrintJobCreator & PrintJobReader {
	const db = `/${printingDbName(shelterCode)}`;

	return {
		/** One PUT; the doc already carries its inline base64 `_attachments` (`label-NNN.png`). */
		async createJob(doc) {
			const { status } = await userRaw(
				cookieHeader,
				`${db}/${encodeURIComponent(doc._id)}`,
				'PUT',
				doc
			);
			if (status !== 201 && status !== 202) throw new PrintDependencyError();
		},

		async get(id) {
			const { status, data } = await userRaw(
				cookieHeader,
				`${db}/${encodeURIComponent(id)}`,
				'GET'
			);
			if (status === 404) return null;
			if (status !== 200) throw new PrintDependencyError();
			return data as PrintJobDoc;
		}
	};
}
