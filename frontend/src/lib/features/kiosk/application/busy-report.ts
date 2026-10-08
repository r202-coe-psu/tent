/**
 * Tells the page whether a kiosk step is busy (camera running, staff on the PIN) only when that
 * changes. `release()` on unmount: a step that goes away while busy must never leave the page's
 * idle timeout paused.
 */
export type BusyReport = {
	update(busy: boolean): void;
	release(): void;
};

export function createBusyReport(onchange: (busy: boolean) => void): BusyReport {
	let reported = false;
	const update = (busy: boolean) => {
		if (busy === reported) return;
		reported = busy;
		onchange(busy);
	};
	return { update, release: () => update(false) };
}
