/**
 * Pure selection rules for the referral evacuee picker (#555). The picker keeps the chosen
 * evacuees themselves (not only ids) so names survive a new search or "โหลดเพิ่ม".
 */
import type { Evacuee, EvacueeSearchPage } from '$lib/features/people';
import type { ParsedPersonQr, PersonQrVerdict } from '$lib/utils/evacuee-qr';

/** Rows the server search loaded, de-duplicated, keeping only people staying in the shelter. */
export function pickableEvacuees(pages: readonly EvacueeSearchPage[]): Evacuee[] {
	const seen = new Set<string>();
	const rows: Evacuee[] = [];
	for (const page of pages) {
		for (const e of page.items) {
			if (seen.has(e._id) || e.current_stay?.status !== 'active') continue;
			seen.add(e._id);
			rows.push(e);
		}
	}
	return rows;
}

export function toggleEvacuee(selected: readonly Evacuee[], evacuee: Evacuee, on: boolean) {
	const without = selected.filter((e) => e._id !== evacuee._id);
	return on ? [...without, evacuee] : without;
}

/** "เลือกทั้งหมด" = only the loaded rows, never the whole shelter; blocked rows are skipped. */
export function selectLoaded(
	selected: readonly Evacuee[],
	loaded: readonly Evacuee[],
	blocked: ReadonlySet<string>
): Evacuee[] {
	const have = new Set(selected.map((e) => e._id));
	return [...selected, ...loaded.filter((e) => !have.has(e._id) && !blocked.has(e._id))];
}

export function clearLoaded(selected: readonly Evacuee[], loaded: readonly Evacuee[]): Evacuee[] {
	const loadedIds = new Set(loaded.map((e) => e._id));
	return selected.filter((e) => !loadedIds.has(e._id));
}

/** State of the header checkbox over the loaded rows a user may pick. */
export function loadedSelectionState(
	selected: readonly Evacuee[],
	loaded: readonly Evacuee[],
	blocked: ReadonlySet<string>
): 'all' | 'some' | 'none' {
	const have = new Set(selected.map((e) => e._id));
	const pickable = loaded.filter((e) => !blocked.has(e._id));
	const count = pickable.filter((e) => have.has(e._id)).length;
	if (count === 0) return 'none';
	return count === pickable.length ? 'all' : 'some';
}

/** What a scanned code becomes in the picker: a search for one person, or a refusal to show. */
export type PickerScanOutcome =
	{ kind: 'search'; query: string } | { kind: 'rejected'; message: string };

export type PickerScanDeps = {
	/** Person QR carried by the code (`evacuee:{ULID}[@hash6]`, handover-slip URL), else `null`. */
	parse: (raw: string) => ParsedPersonQr | null;
	/** Scan rule against the stored prints log; errors propagate (never read as valid). */
	check: (parsed: ParsedPersonQr) => Promise<PersonQrVerdict>;
	message: (verdict: Exclude<PersonQrVerdict, { status: 'valid' }>) => string;
};

/**
 * A scan is a Person QR read point, so the CR-233 rule (FR-EQR-27/30) runs before any search: an
 * expired or invalid QR finds nobody. Codes that are not Person QRs search as typed.
 */
export async function resolvePickerScan(
	raw: string,
	deps: PickerScanDeps
): Promise<PickerScanOutcome> {
	const code = raw.trim();
	const personQr = deps.parse(code);
	if (!personQr) return { kind: 'search', query: code };
	const verdict = await deps.check(personQr);
	if (verdict.status !== 'valid') return { kind: 'rejected', message: deps.message(verdict) };
	return { kind: 'search', query: personQr.evacuee_id };
}
