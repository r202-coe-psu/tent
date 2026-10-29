// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { toast } from 'svelte-sonner';
import type { ThaiDAutofillProfile } from '../../domain/thaid-profile';
import { blankUnifiedMember, type UnifiedMemberWithMeta } from '../../domain/unified-registration';
import UnifiedRegistrationMembersSection from './unified-registration-members-section.svelte';

vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
// QR rendering needs a canvas; the image itself is not under test.
vi.mock('$lib/utils/qrcode', () => ({
	generateQrDataUrl: vi.fn(async () => 'data:image/png;base64,qr')
}));

const scannedProfile: ThaiDAutofillProfile = {
	id: 'thaid-2',
	roleLabel: '',
	person_id: '3901100456789',
	first_name: 'สมหญิง',
	last_name: 'ใจดี',
	nickname: '',
	gender: 'female',
	birth_year: 2535,
	age: 34,
	phone: null,
	vulnerable_groups: [],
	special_needs: [],
	medical_conditions: [],
	address: {
		address_no: '',
		village_no: '',
		subdistrict: '',
		district: '',
		province: '',
		postal_code: ''
	}
};

/** ThaiD scan session SSE stream — the test plays the phone finishing the scan. */
class FakeEventSource {
	static last: FakeEventSource | null = null;
	listeners = new Map<string, (e: MessageEvent) => void>();
	onerror: (() => void) | null = null;
	constructor(public url: string) {
		FakeEventSource.last = this;
	}
	addEventListener(type: string, cb: (e: MessageEvent) => void) {
		this.listeners.set(type, cb);
	}
	close() {}
	emit(type: string, data: unknown) {
		this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
	}
}

let instance: ReturnType<typeof mount> | null = null;

beforeEach(() => {
	vi.clearAllMocks();
	FakeEventSource.last = null;
	vi.stubGlobal('EventSource', FakeEventSource);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) => {
			if (String(input).endsWith('/api/public/v1/thaid/scan-session')) {
				return Response.json({
					sessionId: 'sess-1',
					qrUrl: 'https://example.test/qr',
					expiresAt: Date.now() + 900_000,
					ttlSeconds: 900
				});
			}
			return Response.json({ status: 'pending' });
		})
	);
});

afterEach(async () => {
	if (instance) unmount(instance);
	instance = null;
	// bits-ui restores the body style 24ms after a dialog unmounts; let it run before the DOM goes away.
	await new Promise((resolve) => setTimeout(resolve, 50));
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
});

const inputs = (suffix: string) =>
	[...document.querySelectorAll<HTMLInputElement>(`input[id$="${suffix}"]`)].map((i) => i.value);

describe('UnifiedRegistrationMembersSection — onsite ThaiD scan', () => {
	it('fills only the scanned member row and leaves the head untouched', async () => {
		const members: UnifiedMemberWithMeta[] = [
			{ ...blankUnifiedMember(), first_name: 'สมชาย', last_name: 'ใจดี', phone: '0812345678' },
			{ ...blankUnifiedMember(), last_name: 'ผิด' }
		];
		instance = mount(UnifiedRegistrationMembersSection, {
			target: document.body,
			props: { members, membersSectionDesc: '', channel: 'onsite', thaidEnabled: true }
		});
		flushSync();

		const scanButtons = [...document.querySelectorAll('button')].filter((b) =>
			b.textContent?.includes('สแกน ThaiD')
		);
		expect(scanButtons).toHaveLength(1);
		scanButtons[0].click();

		await vi.waitFor(() => expect(FakeEventSource.last?.url).toContain('sess-1'));
		FakeEventSource.last!.emit('completed', { profile: scannedProfile });

		await vi.waitFor(
			() => {
				flushSync();
				expect(inputs('first-name')).toEqual(['สมชาย', 'สมหญิง']);
			},
			{ timeout: 3000 }
		);
		await tick();
		expect(inputs('last-name')).toEqual(['ใจดี', 'ใจดี']);
	});

	it('names the scanned member from the filled row when ThaiD returns no name', async () => {
		const members: UnifiedMemberWithMeta[] = [
			{ ...blankUnifiedMember(), first_name: 'สมชาย', last_name: 'ใจดี' },
			{ ...blankUnifiedMember(), first_name: 'มานี', last_name: 'มีนา' }
		];
		instance = mount(UnifiedRegistrationMembersSection, {
			target: document.body,
			props: { members, membersSectionDesc: '', channel: 'onsite', thaidEnabled: true }
		});
		flushSync();

		[...document.querySelectorAll('button')]
			.find((b) => b.textContent?.includes('สแกน ThaiD'))!
			.click();
		await vi.waitFor(() => expect(FakeEventSource.last?.url).toContain('sess-1'));
		FakeEventSource.last!.emit('completed', {
			profile: { ...scannedProfile, first_name: '', last_name: '' }
		});

		await vi.waitFor(
			() => expect(toast.success).toHaveBeenCalledWith('ดึงข้อมูล มานี มีนา เรียบร้อยแล้ว'),
			{ timeout: 3000 }
		);
	});
});
