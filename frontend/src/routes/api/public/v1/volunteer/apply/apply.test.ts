import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw } from '$lib/server/couch-admin';
import {
	volunteerApplyIpLimiter,
	volunteerApplyPhoneLimiter
} from '$lib/server/security/rate-limiter';
import { sha256Hex } from '$lib/db/hash';

type PostEvent = Parameters<typeof POST>[0];

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/couch-public-writer', () => ({
	putAsPublicWriter: vi.fn().mockResolvedValue({ status: 200 })
}));

vi.mock('$lib/server/security/rate-limiter', () => ({
	volunteerApplyIpLimiter: { check: vi.fn(() => true) },
	volunteerApplyPhoneLimiter: { check: vi.fn(() => true) }
}));

vi.mock('$lib/server/security/captcha', () => ({
	ReCaptchaProvider: class {
		verifyToken() {
			return Promise.resolve(true);
		}
	}
}));

vi.mock('$env/dynamic/private', () => ({
	env: {
		SECRET_RECAPTCHA_KEY: ''
	}
}));

describe('POST /api/public/v1/volunteer/apply', () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(volunteerApplyIpLimiter.check).mockReturnValue(true);
		vi.mocked(volunteerApplyPhoneLimiter.check).mockReturnValue(true);
	});

	function makeEvent(body: Record<string, unknown>): PostEvent {
		return {
			request: new Request('http://localhost/api/public/v1/volunteer/apply', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			}),
			getClientAddress: () => '127.0.0.1'
		} as unknown as PostEvent;
	}

	it('creates new volunteer with sha256(volunteer_id) token and strips phone hyphens/spaces', async () => {
		const adminRawMock = vi.mocked(adminRaw);

		// 1. Registry query -> shelter_sh001
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				rows: [
					{
						doc: {
							_id: 'shelter:SH001',
							type: 'shelter',
							code: 'SH001',
							db: 'shelter_sh001'
						}
					}
				]
			}
		});

		// 2. Job lookup
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { _id: 'job:job-1', type: 'job', title: 'ครัวกลาง' }
		});

		// 3. All docs lookup in shelter_sh001 -> empty
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { rows: [] }
		});

		// 4. PUT volunteer
		adminRawMock.mockResolvedValueOnce({ status: 201, data: { ok: true } });
		// 5. PUT job_application
		adminRawMock.mockResolvedValueOnce({ status: 201, data: { ok: true } });

		const res = await POST(
			makeEvent({
				job_id: 'job:job-1',
				applicant: {
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					phone: '081-234-5678', // Formatted with hyphens
					skills: ['ประกอบอาหาร / ครัวสนาม']
				},
				selected_shift: {
					date: '2026-06-13',
					start_time: '08:00',
					end_time: '12:00'
				}
			})
		);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.volunteer_id).toMatch(/^volunteer:vol_/);
		const expectedToken = await sha256Hex(json.volunteer_id);
		expect(json.tracking_token).toBe(expectedToken);
		expect(json.application.applicant.phone).toBe('0812345678'); // Stripped hyphens
	});

	it('uses initial registration profile info and appends only new skills for existing phone', async () => {
		const adminRawMock = vi.mocked(adminRaw);
		const phoneHash = await sha256Hex('0812345678');
		const existingVolunteerId = 'volunteer:vol_existing_123';
		const existingToken = await sha256Hex(existingVolunteerId);

		const existingVolunteer = {
			_id: existingVolunteerId,
			type: 'volunteer',
			schema_v: 3,
			shelter_code: 'SH001',
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			phone: '0812345678',
			phone_hash: phoneHash,
			email: 'somchai@example.com',
			skills: ['ประกอบอาหาร / ครัวสนาม'],
			volunteer_code: 'V-001',
			tracking_token: existingToken,
			status: 'active'
		};

		const existingApplication = {
			_id: 'job_application:app_first_shift',
			type: 'job_application',
			job_id: 'job:job-1',
			volunteer_id: existingVolunteerId,
			applicant: {
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				phone: '0812345678',
				phone_hash: phoneHash,
				email: 'somchai@example.com'
			},
			selected_shift: {
				date: '2026-06-13',
				start_time: '08:00',
				end_time: '12:00'
			},
			tracking_token: existingToken,
			status: 'pending_review'
		};

		// 1. Registry query
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				rows: [
					{ doc: { _id: 'shelter:SH001', type: 'shelter', code: 'SH001', db: 'shelter_sh001' } }
				]
			}
		});

		// 2. Job lookup
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { _id: 'job:job-2', type: 'job', title: 'ทีมคัดกรอง' }
		});

		// 3. All docs lookup -> has existing volunteer and existing morning shift
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				rows: [{ doc: existingVolunteer }, { doc: existingApplication }]
			}
		});

		// 4. PUT updated volunteer with merged skills
		adminRawMock.mockResolvedValueOnce({ status: 200, data: { ok: true } });
		// 5. PUT new job_application
		adminRawMock.mockResolvedValueOnce({ status: 201, data: { ok: true } });

		// Apply for afternoon shift with different input name 'นายอื่น', but same phone
		const res = await POST(
			makeEvent({
				job_id: 'job:job-2',
				applicant: {
					first_name: 'นายอื่น',
					last_name: 'คนใหม่',
					phone: '081-234-5678',
					skills: ['ประกอบอาหาร / ครัวสนาม', 'คัดกรองและสแกนประวัติ'] // One existing skill + one new skill
				},
				selected_shift: {
					date: '2026-06-13',
					start_time: '13:00',
					end_time: '17:00'
				}
			})
		);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.success).toBe(true);
		expect(json.volunteer_id).toBe(existingVolunteerId);
		expect(json.tracking_token).toBe(existingToken);
		// Preserved original first/last name from initial profile
		expect(json.application.applicant.first_name).toBe('สมชาย');
		expect(json.application.applicant.last_name).toBe('ใจดี');
		expect(json.application.applicant.email).toBe('somchai@example.com');

		// Check the PUT volunteer call: only unique new skills appended
		const putVolunteerCall = adminRawMock.mock.calls.find((c) =>
			String(c[0]).includes(encodeURIComponent(existingVolunteerId))
		);
		expect(putVolunteerCall).toBeDefined();
		const updatedVolDoc = putVolunteerCall![2] as { skills?: string[]; first_name?: string };
		expect(updatedVolDoc.skills).toEqual(['ประกอบอาหาร / ครัวสนาม', 'คัดกรองและสแกนประวัติ']);
		expect(updatedVolDoc.first_name).toBe('สมชาย');
	});

	it('rejects shift application if time overlaps with existing shift on the same date', async () => {
		const adminRawMock = vi.mocked(adminRaw);
		const phoneHash = await sha256Hex('0812345678');

		const existingVolunteer = {
			_id: 'volunteer:vol_existing_123',
			type: 'volunteer',
			phone: '0812345678',
			phone_hash: phoneHash
		};

		const existingApplication = {
			_id: 'job_application:app_first_shift',
			type: 'job_application',
			job_id: 'job:job-1',
			applicant: {
				phone: '0812345678',
				phone_hash: phoneHash
			},
			selected_shift: {
				date: '2026-06-13',
				start_time: '08:00',
				end_time: '12:00'
			},
			status: 'pending_review'
		};

		// 1. Registry query
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				rows: [
					{ doc: { _id: 'shelter:SH001', type: 'shelter', code: 'SH001', db: 'shelter_sh001' } }
				]
			}
		});

		// 2. Job lookup
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { _id: 'job:job-2', type: 'job', title: 'งานพลาธิการ' }
		});

		// 3. All docs lookup -> has existing morning shift (08:00 - 12:00)
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: {
				rows: [{ doc: existingVolunteer }, { doc: existingApplication }]
			}
		});

		// Apply for overlapping shift (10:00 - 14:00) on the same date
		const res = await POST(
			makeEvent({
				job_id: 'job:job-2',
				applicant: {
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					phone: '0812345678',
					skills: ['ขนย้ายสิ่งของ / พลาธิการ']
				},
				selected_shift: {
					date: '2026-06-13',
					start_time: '10:00',
					end_time: '14:00'
				}
			})
		);

		expect(res.status).toBe(409);
		const json = await res.json();
		expect(json.success).toBe(false);
		expect(json.error).toBe('TIME_CONFLICT');
		expect(json.message).toContain('ทับซ้อนกับกะงาน');
	});
});
