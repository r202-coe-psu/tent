import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { toast } from 'svelte-sonner';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import { peopleKeys, peopleRepository } from '$lib/features/people';
import type { AuthorContext } from '$lib/db/model';
import { PEOPLE_IMPORT_LOG_TYPE } from '../domain/import-log';
import { createPeopleImportLog, type ImportRowResult } from '../domain/import-log';
import type { RowValidation } from '../domain/import-row';
import type { DuplicateMatch } from '../domain/duplicates';
import { importLogDb, listImportLogs, writeImportLog } from '../data/import-log.remote';

/**
 * People/household Excel import — TanStack Query wiring (CR-071 slice A / T-72).
 *
 * The import mutation writes one household at a time through the same
 * `peopleRepository` the registration wizard uses, records the per-row outcome
 * in a `people_import_log`, then invalidates the people lists. Partial success
 * is the contract: a household that fails leaves the ones already written in
 * place. Log reactivity rides the shelter DB's changes feed — no polling.
 *
 * Write order per household is deliberately household → head → members, the
 * reverse of the wizard's. The wizard can afford head-first because a person
 * stays on screen until their household is created; an unattended import
 * cannot, and a person with no household breaks the invariant that every
 * evacuee belongs to one (CR-076). An empty household is visible in the list
 * and can be cancelled; a household-less person is not.
 */

export const peopleImportKeys = {
	all: ['people-import'] as const,
	logs: (shelterDb: string) => [...peopleImportKeys.all, 'logs', shelterDb] as const
};

export function useImportLogs() {
	return createQuery(() => ({
		queryKey: peopleImportKeys.logs(importLogDb()),
		queryFn: () => listImportLogs()
	}));
}

export interface ImportPeopleInput {
	filename: string;
	ctx: AuthorContext;
	rows: RowValidation[];
	/** row number → the people in that row who already exist in this shelter */
	duplicates: Map<number, DuplicateMatch>;
}

export function useImportPeople() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ filename, ctx, rows, duplicates }: ImportPeopleInput) => {
			const started_at = new Date().toISOString();
			const repo = peopleRepository();
			const results: ImportRowResult[] = [];
			let createdPeople = 0;
			let skippedPeople = 0;

			for (const row of rows) {
				if (!row.ok || !row.payload) {
					results.push({
						row: row.row,
						label: row.label,
						status: 'validation_error',
						errors: row.errors
					});
					continue;
				}

				const duplicate = duplicates.get(row.row);
				// A head who already exists means this household is almost certainly
				// registered already — skip the whole row rather than create a second
				// household around the same person.
				if (duplicate?.head) {
					results.push({
						row: row.row,
						label: row.label,
						status: 'skipped_duplicate',
						existing_evacuee_id: duplicate.head.existingId
					});
					// The whole household is skipped, so every person in it is.
					skippedPeople += 1 + row.payload.members.length;
					continue;
				}

				const skippedLines = new Set((duplicate?.members ?? []).map((m) => m.line));
				try {
					const household = await repo.createHousehold(row.payload.household, ctx);
					const head = await repo.createEvacuee(
						{ ...row.payload.head, household_id: household._id },
						ctx
					);
					await repo.patchHousehold(household._id, { head_evacuee_id: head._id });
					createdPeople += 1;

					let createdMembers = 0;
					for (const member of row.payload.members) {
						if (skippedLines.has(member.line)) continue;
						await repo.createEvacuee({ ...member.evacuee, household_id: household._id }, ctx);
						createdMembers += 1;
					}
					createdPeople += createdMembers;
					skippedPeople += skippedLines.size;

					results.push({
						row: row.row,
						label: row.label,
						status: 'created',
						household_id: household._id,
						created_members: createdMembers,
						skipped_members: skippedLines.size
					});
				} catch (e) {
					results.push({
						row: row.row,
						label: row.label,
						status: 'server_error',
						errors: [
							{ column: '-', message: e instanceof Error ? e.message : 'บันทึกข้อมูลไม่สำเร็จ' }
						]
					});
				}
			}

			const finished_at = new Date().toISOString();
			const log = createPeopleImportLog(
				{
					source: 'people',
					filename,
					imported_by: ctx.createdBy,
					total_rows: rows.length,
					success_count: results.filter((r) => r.status === 'created').length,
					skipped_count: results.filter((r) => r.status === 'skipped_duplicate').length,
					error_count: results.filter(
						(r) => r.status === 'validation_error' || r.status === 'server_error'
					).length,
					created_people: createdPeople,
					skipped_people: skippedPeople,
					results,
					started_at,
					finished_at
				},
				ctx
			);
			await writeImportLog(log);
			return log;
		},
		onSuccess: (log) => {
			queryClient.invalidateQueries({ queryKey: peopleKeys.evacuees() });
			queryClient.invalidateQueries({ queryKey: peopleKeys.households() });
			queryClient.invalidateQueries({ queryKey: peopleImportKeys.logs(importLogDb()) });

			// Build the summary from whichever outcomes actually occurred, so a run
			// that only skipped duplicates never reads "นำเข้า 0 ครัวเรือน".
			const parts: string[] = [];
			if (log.success_count > 0 || log.skipped_count === 0) {
				parts.push(`นำเข้า ${log.success_count} ครัวเรือน (${log.created_people} คน)`);
			}
			if (log.skipped_count > 0) parts.push(`ข้าม ${log.skipped_count} ครัวเรือน (มีอยู่แล้ว)`);
			if (log.skipped_people > log.skipped_count) {
				parts.push(`ข้ามรายบุคคล ${log.skipped_people} คน`);
			}
			if (log.error_count > 0) parts.push(`ล้มเหลว ${log.error_count} แถว`);

			if (log.error_count > 0) {
				toast.warning(`${parts.join(', ')} — ดูรายละเอียดในประวัติการนำเข้า`);
			} else {
				toast.success(parts.join(', '));
			}
		},
		onError: (e: unknown) => {
			toast.error(e instanceof Error ? e.message : 'นำเข้าไม่สำเร็จ');
		}
	}));
}

/** Wire the shelter DB's changes feed → import-log query invalidation. */
export function startPeopleImportLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	const db = importLogDb();
	return subscribeDataChanges(queryClient, db, (type) =>
		type === PEOPLE_IMPORT_LOG_TYPE ? [peopleImportKeys.logs(db)] : []
	);
}
