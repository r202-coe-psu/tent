import { printingRaw } from '$lib/server/couch-printing-service';
// eslint-disable-next-line no-restricted-imports -- server-safe domain rule; feature barrel pulls client UI/query code
import { printingDbName } from '$lib/features/printers/domain/printing-db';
import { PrintDependencyError } from './device-credentials';
import type { PrintJobLastReader } from './printer-admin.server';
import type {
	PrintJobDoc,
	PrintJobPutResult,
	PrintJobRetentionStore,
	PrintJobStatus,
	PrintJobStore
} from './print-queue.server';

/**
 * CouchDB adapter for one shelter's print-job DB `printing_{code}`, reached as `printing_service`
 * (DB admin of the printing databases only). Reads treat a missing DB (closed shelter / not yet
 * provisioned) as "no jobs" because housekeeping iterates every registered shelter.
 */

/** Mango only picks a json index when the selector names every field of it. */
const ANY = { $gt: null };

/** Field that completes a `[status, …]` index for a status-only query (sweeper / retention). */
const STATUS_INDEX_FIELD: Record<PrintJobStatus, keyof PrintJobDoc> = {
	pending: 'expires_at',
	printing: 'lease_until',
	printed: 'finished_at',
	failed: 'finished_at',
	expired: 'finished_at'
};

const LABEL_NAME = /^label-\d+\.png$/;

type AttachmentWithData = { data?: string } & Record<string, unknown>;

/** A job doc plus its label images (base64, in `label-NNN.png` order) from a single read. */
export interface PrintJobWithLabels {
	/** `_attachments` are stubs (no image data), so a PUT of this doc keeps the attachments. */
	doc: PrintJobDoc;
	labels: string[];
}

export type PrintJobServiceStore = PrintJobStore &
	PrintJobRetentionStore &
	PrintJobLastReader & {
		/** Doc + labels in one `?attachments=true` GET; null when the job is missing. */
		getWithLabels(id: string): Promise<PrintJobWithLabels | null>;
		/** Delete finished docs at their `_rev` via `_bulk_docs`; returns how many were deleted. */
		removeFinished(docs: ReadonlyArray<{ _id: string; _rev?: string }>): Promise<number>;
	};

function labelsOf(attachments: Record<string, AttachmentWithData> | undefined): string[] {
	return Object.entries(attachments ?? {})
		.filter(([name]) => LABEL_NAME.test(name))
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, attachment]) => attachment.data ?? '');
}

function toStubs(
	attachments: Record<string, AttachmentWithData>
): Record<string, Record<string, unknown>> {
	return Object.fromEntries(
		Object.entries(attachments).map(([name, attachment]) => {
			const stub: Record<string, unknown> = { ...attachment, stub: true };
			delete stub.data;
			return [name, stub];
		})
	);
}

/** Print-job store of shelter `shelterCode`. Throws for a code that cannot form a DB name. */
export function printJobStoreFor(shelterCode: string): PrintJobServiceStore {
	const db = `/${printingDbName(shelterCode)}`;

	async function find<T>(selector: Record<string, unknown>, limit: number): Promise<T[]> {
		const { status, data } = await printingRaw(`${db}/_find`, 'POST', { selector, limit });
		if (status === 404) return [];
		if (status !== 200) throw new PrintDependencyError();
		return (data as { docs: T[] }).docs;
	}

	async function getWithAttachments(
		id: string
	): Promise<(PrintJobDoc & { _attachments?: Record<string, AttachmentWithData> }) | null> {
		const { status, data } = await printingRaw(
			`${db}/${encodeURIComponent(id)}?attachments=true`,
			'GET'
		);
		if (status === 404) return null;
		if (status !== 200) throw new PrintDependencyError();
		return data as PrintJobDoc & { _attachments?: Record<string, AttachmentWithData> };
	}

	async function removeFinished(
		docs: ReadonlyArray<{ _id: string; _rev?: string }>
	): Promise<number> {
		if (docs.length === 0) return 0;
		const { status, data } = await printingRaw(`${db}/_bulk_docs`, 'POST', {
			docs: docs.map(({ _id, _rev }) => ({ _id, _rev, _deleted: true }))
		});
		if (status === 404) return 0;
		if (status !== 201 && status !== 202) throw new PrintDependencyError();
		return (data as { ok?: boolean }[]).filter((row) => row.ok === true).length;
	}

	return {
		findJobs({ status, printerId }) {
			return find<PrintJobDoc>(
				printerId !== undefined
					? { type: 'print_job', printer_id: printerId, status, created_at: ANY }
					: { type: 'print_job', status, [STATUS_INDEX_FIELD[status]]: ANY },
				100
			);
		},

		async get(id) {
			const { status, data } = await printingRaw(`${db}/${encodeURIComponent(id)}`, 'GET');
			if (status === 404) return null;
			if (status !== 200) throw new PrintDependencyError();
			return data as PrintJobDoc;
		},

		/** Back-office list: newest job of a printer. Served by the `print-job-printer-created` index. */
		async lastJobOf(printerId) {
			const { status, data } = await printingRaw(`${db}/_find`, 'POST', {
				selector: { type: 'print_job', printer_id: printerId, created_at: ANY },
				sort: [{ printer_id: 'desc' }, { created_at: 'desc' }],
				limit: 1,
				fields: ['_id', 'status', 'finished_at', 'error_code', 'created_at', 'printer_id']
			});
			if (status === 404) return null;
			if (status !== 200) throw new PrintDependencyError();
			return ((data as { docs: PrintJobDoc[] }).docs[0] as PrintJobDoc | undefined) ?? null;
		},

		async put(doc): Promise<PrintJobPutResult> {
			const { status, data } = await printingRaw(
				`${db}/${encodeURIComponent(doc._id)}`,
				'PUT',
				doc
			);
			if (status === 409) return { conflict: true };
			if (status !== 201 && status !== 202) throw new PrintDependencyError();
			return { ok: true, rev: (data as { rev: string }).rev };
		},

		async pendingCursor() {
			const { status, data } = await printingRaw(db, 'GET');
			if (status === 404) return '0';
			if (status !== 200) throw new PrintDependencyError();
			return String((data as { update_seq: string | number }).update_seq);
		},

		async waitForPending(printerId, since, { timeoutMs, signal }) {
			const query = new URLSearchParams({
				feed: 'longpoll',
				filter: '_selector',
				since,
				timeout: String(Math.max(0, Math.floor(timeoutMs)))
			});
			try {
				const { status } = await printingRaw(
					`${db}/_changes?${query}`,
					'POST',
					{ selector: { type: 'print_job', printer_id: printerId, status: 'pending' } },
					signal
				);
				// A missing DB is an error here (not "no jobs"): resolving at once would spin the poller.
				if (status !== 200) throw new PrintDependencyError();
			} catch (error) {
				// Client hung up: the caller checks `signal.aborted` and stops.
				if (signal.aborted) return;
				throw error;
			}
		},

		/** One batch per terminal status, served by `print-job-status-finished`. */
		async findFinishedBefore(cutoff) {
			const batches = await Promise.all(
				(['printed', 'failed', 'expired'] as const).map((status) =>
					find<PrintJobDoc>(
						{ type: 'print_job', status, finished_at: { $gt: null, $lt: cutoff } },
						100
					)
				)
			);
			return batches.flat();
		},

		removeFinished,

		/**
		 * Retention removal. Named `purge` for the `PrintJobRetentionStore` port, but CouchDB 3.5.2
		 * `_purge` needs the server admin, which `printing_service` must never hold — so finished
		 * jobs are deleted (`_bulk_docs` tombstones) and the `compact` that follows drops the old
		 * revisions carrying label images.
		 */
		purge: removeFinished,

		async compact() {
			const { status } = await printingRaw(`${db}/_compact`, 'POST', {});
			if (status === 404) return;
			if (status !== 202) throw new PrintDependencyError();
		},

		async getLabels(jobId) {
			const doc = await getWithAttachments(jobId);
			return labelsOf(doc?._attachments);
		},

		async getWithLabels(id) {
			const doc = await getWithAttachments(id);
			if (!doc) return null;
			const { _attachments, ...rest } = doc;
			return {
				doc: _attachments ? { ...rest, _attachments: toStubs(_attachments) } : rest,
				labels: labelsOf(_attachments)
			};
		}
	};
}
