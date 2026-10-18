import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	KIOSK_BANNER_URL_TTL_MS,
	signBannerImageUrl,
	verifyBannerImageSig
} from './signed-image-url';

const mockEnv = vi.hoisted(
	() => ({ EXTERNAL_API_SECRET: 'test-banner-secret' }) as Record<string, string | undefined>
);
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const NOW = 1_800_000_000_000;

function parts(url: string) {
	const u = new URL(url, 'http://localhost');
	return { path: u.pathname, exp: u.searchParams.get('exp'), sig: u.searchParams.get('sig') };
}

beforeEach(() => {
	mockEnv.EXTERNAL_API_SECRET = 'test-banner-secret';
});

describe('signBannerImageUrl / verifyBannerImageSig', () => {
	it('round-trips a signed url', () => {
		const { exp, sig } = parts(signBannerImageUrl('banner-1', NOW));
		expect(verifyBannerImageSig('banner-1', exp, sig, NOW)).toBe(true);
	});

	it('builds /api/v1/kiosk/banners/{encoded id}/image?exp&sig', () => {
		const url = signBannerImageUrl('a/b c', NOW);
		const { path, exp, sig } = parts(url);
		expect(url.startsWith('/api/v1/kiosk/banners/a%2Fb%20c/image?exp=')).toBe(true);
		expect(path).toBe('/api/v1/kiosk/banners/a%2Fb%20c/image');
		expect(exp).toBe(String(Math.floor((NOW + KIOSK_BANNER_URL_TTL_MS) / 1000)));
		expect(sig).toMatch(/^[0-9a-f]{64}$/);
	});

	it('rejects an expired signature', () => {
		const { exp, sig } = parts(signBannerImageUrl('banner-1', NOW));
		expect(verifyBannerImageSig('banner-1', exp, sig, NOW + KIOSK_BANNER_URL_TTL_MS - 1000)).toBe(
			true
		);
		expect(verifyBannerImageSig('banner-1', exp, sig, NOW + KIOSK_BANNER_URL_TTL_MS)).toBe(false);
		expect(verifyBannerImageSig('banner-1', exp, sig, NOW + KIOSK_BANNER_URL_TTL_MS + 60_000)).toBe(
			false
		);
	});

	it('rejects tampered sig, id or exp', () => {
		const { exp, sig } = parts(signBannerImageUrl('banner-1', NOW));
		const flipped = (sig as string).replace(/^./, (c) => (c === '0' ? '1' : '0'));
		expect(verifyBannerImageSig('banner-1', exp, flipped, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-2', exp, sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', String(Number(exp) + 1), sig, NOW)).toBe(false);
	});

	it('rejects missing, malformed or non-numeric inputs', () => {
		const { exp, sig } = parts(signBannerImageUrl('banner-1', NOW));
		expect(verifyBannerImageSig('banner-1', null, sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', exp, null, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', 'abc', sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', '1e12', sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', '-5', sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', '0', sig, NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', exp, 'zz', NOW)).toBe(false);
		expect(verifyBannerImageSig('banner-1', exp, (sig as string).toUpperCase(), NOW)).toBe(false);
	});

	it('throws when the secret is missing or empty', () => {
		mockEnv.EXTERNAL_API_SECRET = undefined;
		expect(() => signBannerImageUrl('banner-1', NOW)).toThrow(/EXTERNAL_API_SECRET/);
		mockEnv.EXTERNAL_API_SECRET = '';
		expect(() => signBannerImageUrl('banner-1', NOW)).toThrow();
		expect(() => verifyBannerImageSig('banner-1', '9999999999', 'a'.repeat(64), NOW)).toThrow();
	});
});
