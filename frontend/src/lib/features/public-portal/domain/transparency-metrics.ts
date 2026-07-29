export type BirthYearViewRow = {
	key: unknown;
	value: unknown;
};

/** CouchDB stores birth_year as a Buddhist Era year in this view. */
export function isValidThaiBirthYear(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value > 2400 && value < 2600;
}

export function countVulnerableFromBirthYearRows(
	rows: unknown,
	currentYear = new Date().getFullYear()
): number {
	if (!Array.isArray(rows)) return 0;

	let vulnerableCount = 0;

	for (const row of rows) {
		if (!row || typeof row !== 'object') continue;
		const viewRow = row as BirthYearViewRow;
		if (!isValidThaiBirthYear(viewRow.key)) continue;

		const age = currentYear - (viewRow.key - 543);
		if (
			(age <= 4 || age >= 60) &&
			typeof viewRow.value === 'number' &&
			Number.isFinite(viewRow.value) &&
			viewRow.value >= 0
		) {
			vulnerableCount += viewRow.value;
		}
	}

	return vulnerableCount;
}
