import { requiresExpiry, suggestExpiry, type ExpirySource } from '$lib/features/catalog';

/**
 * State of the receive form's `lot.expiry` field (CR-143 §D, FR-D2a–D2c).
 *
 * `autoFilled` drives the "check against the label" hint and exists in the UI only —
 * it is never persisted to the ledger (FR-D2b). `touched` means the user has typed,
 * cleared or confirmed the value, after which the system stops recalculating it.
 */
export type ExpiryState = {
	/** `YYYY-MM-DD`, or '' when empty. */
	value: string;
	/** The value was computed from `shelf_life_days` and not yet edited or confirmed. */
	autoFilled: boolean;
	/** The user has taken ownership of the value. */
	touched: boolean;
	/** The shelf life the autofill used, for the hint text. */
	shelfLifeDays: number | null;
};

/** The catalog facts the expiry field reacts to. */
export type ExpiryItem = ExpirySource & { requiresExpiry?: boolean };

export function initialExpiryState(): ExpiryState {
	return { value: '', autoFilled: false, touched: false, shelfLifeDays: null };
}

/**
 * Re-derive the expiry from the selected item and production date. A no-op once the
 * user has touched the field (AC-D5, AC-D6). With no shelf life to compute from — no
 * item, CHILLED / FROZEN without one, or an item switch (FR-D2c) — a previous autofill
 * is cleared rather than left stale.
 */
export function applyExpiryAutofill(
	state: ExpiryState,
	item: ExpiryItem | null,
	producedAt: string | undefined | null,
	receivedOn: string
): ExpiryState {
	if (state.touched) return state;
	const suggestion = item ? suggestExpiry(item, producedAt, receivedOn) : null;
	if (!suggestion) {
		return state.autoFilled || state.value ? initialExpiryState() : state;
	}
	return {
		value: suggestion.expiry,
		autoFilled: true,
		touched: false,
		shelfLifeDays: suggestion.shelfLifeDays
	};
}

/**
 * The user typed, picked or cleared a date. Re-reporting the value already shown (the
 * date picker echoes programmatic changes) is not an edit.
 */
export function editExpiry(state: ExpiryState, value: string): ExpiryState {
	const next = value.trim();
	if (next === state.value) return state;
	return { value: next, autoFilled: false, touched: true, shelfLifeDays: null };
}

/** The user checked the computed date against the label: keep it, drop the hint. */
export function confirmExpiry(state: ExpiryState): ExpiryState {
	return state.autoFilled ? { ...state, autoFilled: false, touched: true } : state;
}

/** FR-D2 — the receive must not be saved while this is true. */
export function expiryMissing(item: ExpiryItem | null, state: ExpiryState): boolean {
	if (!item) return false;
	return (item.requiresExpiry ?? requiresExpiry(item)) && !state.value.trim();
}

/** Today as a local `YYYY-MM-DD` — the receive date the form measures shelf life from. */
export function todayLocalIso(now: Date = new Date()): string {
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	return `${now.getFullYear()}-${mm}-${dd}`;
}

export type ExpiryPreset = {
	id: '7d' | '6m' | '1y';
	label: string;
	days?: number;
	months?: number;
	years?: number;
};

/** Quick expiry shortcuts on the receive form, counted from the receive date. */
export const EXPIRY_PRESETS: readonly ExpiryPreset[] = [
	{ id: '7d', label: '7 วัน', days: 7 },
	{ id: '6m', label: '6 เดือน', months: 6 },
	{ id: '1y', label: '1 ปี', years: 1 }
];

/** `today` (`YYYY-MM-DD`) moved forward by the preset, clamped to month end (31 ม.ค. + 1 เดือน → 28/29 ก.พ.). */
export function expiryPresetDate(today: string, preset: ExpiryPreset): string {
	const [y, m, d] = today.split('-').map(Number) as [number, number, number];
	const year = y + (preset.years ?? 0);
	const monthIndex = m - 1 + (preset.months ?? 0);
	const lastDay = new Date(year, monthIndex + 1, 0).getDate();
	const date = new Date(year, monthIndex, Math.min(d, lastDay));
	date.setDate(date.getDate() + (preset.days ?? 0));
	return todayLocalIso(date);
}

/** The preset whose date equals the current expiry, so the form can show it as chosen. */
export function matchingExpiryPreset(today: string, value: string): ExpiryPreset['id'] | null {
	if (!value) return null;
	return EXPIRY_PRESETS.find((p) => expiryPresetDate(today, p) === value)?.id ?? null;
}
