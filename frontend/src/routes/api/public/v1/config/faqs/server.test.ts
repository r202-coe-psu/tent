import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn()
}));

vi.mock('$lib/server/fastapi', () => ({
	fastapiBaseUrl: vi.fn(() => 'http://fastapi-test:9000'),
	fastapiServiceHeaders: vi.fn(() => ({ Authorization: 'Bearer test' }))
}));

type GetEvent = Parameters<typeof GET>[0];

function createGetEvent(urlStr: string = 'http://localhost/api/public/v1/config/faqs'): GetEvent {
	const url = new URL(urlStr);
	return {
		url,
		fetch: vi.fn()
	} as unknown as GetEvent;
}

describe('GET /api/public/v1/config/faqs', () => {
	beforeEach(() => {
		vi.mocked(adminRaw).mockReset();
	});

	it('reads faqs directly from CouchDB config:public_portal and filters/sorts items', async () => {
		vi.mocked(adminRaw).mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'config:public_portal',
				faqs: {
					public: [
						{ id: '2', question: 'คำถามที่ 2', answer: 'คำตอบที่ 2', is_published: true, order: 2 },
						{ id: '1', question: 'คำถามที่ 1', answer: 'คำตอบที่ 1', is_published: true, order: 1 },
						{
							id: '3',
							question: 'คำถามที่ซ่อน',
							answer: 'คำตอบที่ซ่อน',
							is_published: false,
							order: 0
						}
					]
				},
				phone_number: '074-282000',
				line_oa_url: 'https://line.me/ti/p/test',
				facebook_url: 'https://facebook.com/test'
			}
		});

		const event = createGetEvent('http://localhost/api/public/v1/config/faqs?category=public');
		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.faqs).toHaveLength(2);
		expect(data.faqs[0].id).toBe('1');
		expect(data.faqs[1].id).toBe('2');
		expect(data.phone_number).toBe('074-282000');
		expect(data.line_oa_url).toBe('https://line.me/ti/p/test');
		expect(data.facebook_url).toBe('https://facebook.com/test');
	});

	it('filters by category specified in query params', async () => {
		vi.mocked(adminRaw).mockResolvedValueOnce({
			status: 200,
			data: {
				_id: 'config:public_portal',
				faqs: {
					public: [{ id: '1', question: 'Public Q', answer: 'A', is_published: true, order: 0 }],
					volunteer: [
						{ id: 'vol-1', question: 'Volunteer Q', answer: 'A', is_published: true, order: 0 }
					]
				}
			}
		});

		const event = createGetEvent('http://localhost/api/public/v1/config/faqs?category=volunteer');
		const res = await GET(event);
		const data = await res.json();

		expect(data.faqs).toHaveLength(1);
		expect(data.faqs[0].id).toBe('vol-1');
	});

	it('falls back to FastAPI when CouchDB returns 404', async () => {
		vi.mocked(adminRaw).mockResolvedValueOnce({
			status: 404,
			data: { error: 'not_found' }
		});

		const mockFetch = vi.fn().mockResolvedValueOnce({
			ok: true,
			json: async () => ({
				faqs: [{ id: 'fastapi-1', question: 'FastAPI Q', answer: 'A' }]
			})
		});

		const event = {
			url: new URL('http://localhost/api/public/v1/config/faqs'),
			fetch: mockFetch
		} as unknown as GetEvent;

		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data.faqs[0].id).toBe('fastapi-1');
	});
});
