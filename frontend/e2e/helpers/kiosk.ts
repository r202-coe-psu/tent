import type { Page, Route } from '@playwright/test';

/**
 * Kiosk screens talk only to the scanner-authenticated `/api/v1/scanner/kiosk/*` endpoints, so the
 * layout tests mock those and need no CouchDB.
 */

export const KIOSK_SHELTER_CODE = 'SH001';
export const KIOSK_CITIZEN_ID = '1234567890123';

const CONTEXT = new URLSearchParams({
	shelter_name: 'ศูนย์พักพิงทดสอบ',
	shelter_code: KIOSK_SHELTER_CODE,
	station_name: 'จุดคัดกรองทั่วไป',
	device_name: 'KIOSK-01'
});
export const KIOSK_QUERY = `?${CONTEXT.toString()}`;

const FIRST_NAMES = ['สมชาย', 'สมหญิง', 'วิชัย', 'มาลี', 'ประยุทธ', 'สุดา', 'นิรันดร์', 'กานดา'];

export function kioskMembers(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		evacuee_id: `evacuee:M${String(index + 1).padStart(2, '0')}`,
		first_name: FIRST_NAMES[index % FIRST_NAMES.length],
		last_name: 'ใจดี',
		gender: index % 2 === 0 ? 'male' : 'female',
		age: 8 + index * 7,
		// Every third member has already reported — exercises the non-selectable row.
		status: index % 3 === 2 ? 'arriving' : 'pre_registered',
		is_primary: index === 0,
		phone_matched: index === 0,
		selectable: index % 3 !== 2
	}));
}

export type KioskLookupScenario =
	| { kind: 'household'; members: number }
	| { kind: 'candidates' }
	| { kind: 'error'; status: number; code: string; message: string; canRegister?: boolean };

export type KioskFaceVerdict =
	| { result: 'match'; attempt: number }
	| { result: 'retry'; hint: string; attempt: number }
	| { result: 'not_confirmed'; reason: string; attempt: number }
	| { result: 'skipped'; reason: string; attempt: number };

/** The scanner client's face check: reported by `/hardware`, answered by `/face/*`. */
export interface KioskFaceMock {
	mode: 'shadow' | 'on';
	flows?: ('check_in' | 'walk_in')[];
	/** What `face/verify` answers, in order; the last one repeats. Default: a match. */
	verdicts?: KioskFaceVerdict[];
	reference?: 'reading' | 'ready' | 'unavailable';
}

export interface KioskMockOptions {
	phoneCheckInEnabled?: boolean;
	lookup?: KioskLookupScenario;
	/** `hold` keeps the print request pending until `releasePrint()`. */
	print?: 'ok' | 'hold';
	face?: KioskFaceMock;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
	return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

export async function mockKioskApi(page: Page, options: KioskMockOptions = {}) {
	const { phoneCheckInEnabled = true, lookup = { kind: 'household', members: 4 } } = options;
	let releasePrint: () => void = () => {};
	const printGate = new Promise<void>((resolve) => {
		releasePrint = resolve;
	});

	await page.route('**/api/v1/scanner/kiosk/config', (route) =>
		json(route, 200, {
			phone_check_in_enabled: phoneCheckInEnabled,
			walk_in_registration_enabled: true
		})
	);

	await page.route('**/api/v1/scanner/kiosk/lookup', async (route) => {
		const body = route.request().postDataJSON() as { primary_evacuee_id?: string };
		if (lookup.kind === 'error') {
			return json(route, lookup.status, {
				error: { code: lookup.code, message: lookup.message },
				can_register: lookup.canRegister === true
			});
		}
		if (lookup.kind === 'candidates' && !body.primary_evacuee_id) {
			return json(route, 200, {
				kind: 'candidates',
				shelter_code: KIOSK_SHELTER_CODE,
				candidates: [
					{
						primary_evacuee_id: 'evacuee:M01',
						contact_display: 'สมชาย ใจดี',
						member_count: 4,
						pending_count: 3
					},
					{
						primary_evacuee_id: 'evacuee:N01',
						contact_display: 'มาลี สุขใจ',
						member_count: 2,
						pending_count: 0
					}
				]
			});
		}
		const members = lookup.kind === 'household' ? lookup.members : 4;
		return json(route, 200, {
			kind: 'household',
			name_masked: false,
			shelter_code: KIOSK_SHELTER_CODE,
			primary_evacuee_id: 'evacuee:M01',
			members: kioskMembers(members)
		});
	});

	await page.route('**/api/v1/scanner/kiosk/check-in', async (route) => {
		const body = route.request().postDataJSON() as { evacuee_ids: string[] };
		return json(route, 200, {
			shelter_code: KIOSK_SHELTER_CODE,
			members: body.evacuee_ids.map((id) => ({
				evacuee_id: id,
				status: 'checked_in',
				stay_status: 'arriving',
				qr_payload: `evacuee:01J0000000000000000000${id.slice(-4).toUpperCase()}`
			}))
		});
	});

	// What the page asked of the scanner client, in order: 'face/start', 'face/frame', 'register', ...
	const calls: string[] = [];

	await page.route('**/api/v1/scanner/kiosk/register', (route) => {
		calls.push('register');
		return json(route, 200, { evacuee_id: 'evacuee:NEW01' });
	});

	if (options.face) {
		const face = options.face;
		const verdicts = [...(face.verdicts ?? [{ result: 'match', attempt: 1 } as const])];
		await page.route('**/api/v1/scanner/kiosk/hardware', (route) =>
			json(route, 200, {
				qr_input: 'camera',
				camera_label: null,
				reader_max_gap_ms: 50,
				face_check: { mode: face.mode, flows: face.flows ?? ['check_in', 'walk_in'] }
			})
		);
		await page.route('**/api/v1/scanner/kiosk/face/*', (route) => {
			const action = new URL(route.request().url()).pathname.split('/').pop()!;
			calls.push(`face/${action}`);
			if (action === 'start') {
				return json(route, 200, { ok: true, reference: face.reference ?? 'reading' });
			}
			if (action === 'frame') return json(route, 200, { face: true, hint: 'ok', ready: true });
			if (action === 'verify') {
				return json(route, 200, verdicts.length > 1 ? verdicts.shift() : verdicts[0]);
			}
			return json(route, 200, { ok: true });
		});
	}

	await page.route('**/api/v1/scanner/kiosk/print', async (route) => {
		if (options.print === 'hold') await printGate;
		return json(route, 200, { printed: 1 });
	});

	return { releasePrint: () => releasePrint(), calls };
}

/** The numpad drops taps closer than 80 ms, so space them out. */
export async function tapDigits(page: Page, digits: string): Promise<void> {
	for (const digit of digits) {
		await page.getByRole('button', { name: `ตัวเลข ${digit}` }).click();
		await page.waitForTimeout(100);
	}
}

export async function dispatchKioskEvent(
	page: Page,
	name: string,
	detail?: Record<string, unknown>
): Promise<void> {
	await page.evaluate(
		([eventName, eventDetail]) =>
			window.dispatchEvent(new CustomEvent(eventName as string, { detail: eventDetail })),
		[name, detail] as const
	);
}
