// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	canRequestGeolocation,
	geolocationBlockReason,
	GeolocationUnavailableError,
	requestUserPosition
} from './geolocation';

function stubSecureContext(value: boolean) {
	Object.defineProperty(window, 'isSecureContext', { configurable: true, value });
}

function stubPolicy(allows: boolean | null) {
	if (allows === null) {
		delete (document as { permissionsPolicy?: unknown }).permissionsPolicy;
		return;
	}
	Object.defineProperty(document, 'permissionsPolicy', {
		configurable: true,
		value: { allowsFeature: (feature: string) => feature === 'geolocation' && allows }
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
	stubPolicy(null);
	stubSecureContext(true);
});

describe('geolocationBlockReason', () => {
	it('returns unsupported when the API is missing', () => {
		vi.stubGlobal('navigator', {});
		expect(geolocationBlockReason()).toBe('unsupported');
		expect(canRequestGeolocation()).toBe(false);
	});

	it('returns insecure when the page is not a secure context', () => {
		vi.stubGlobal('navigator', { geolocation: {} });
		stubSecureContext(false);
		expect(geolocationBlockReason()).toBe('insecure');
	});

	it('returns policy when Permissions-Policy disallows geolocation', () => {
		vi.stubGlobal('navigator', { geolocation: {} });
		stubSecureContext(true);
		stubPolicy(false);
		expect(geolocationBlockReason()).toBe('policy');
		expect(canRequestGeolocation()).toBe(false);
	});

	it('returns null when geolocation can be requested', () => {
		vi.stubGlobal('navigator', { geolocation: {} });
		stubSecureContext(true);
		stubPolicy(true);
		expect(geolocationBlockReason()).toBeNull();
		expect(canRequestGeolocation()).toBe(true);
	});
});

describe('requestUserPosition', () => {
	it('does not call getCurrentPosition when policy blocks it', async () => {
		const getCurrentPosition = vi.fn();
		vi.stubGlobal('navigator', { geolocation: { getCurrentPosition } });
		stubSecureContext(true);
		stubPolicy(false);

		await expect(requestUserPosition()).rejects.toMatchObject({ reason: 'policy' });
		expect(getCurrentPosition).not.toHaveBeenCalled();
	});

	it('resolves coordinates from getCurrentPosition', async () => {
		vi.stubGlobal('navigator', {
			geolocation: {
				getCurrentPosition: (success: PositionCallback) => {
					success({
						coords: { latitude: 7.88, longitude: 98.39 }
					} as GeolocationPosition);
				}
			}
		});
		stubSecureContext(true);
		stubPolicy(true);

		await expect(requestUserPosition()).resolves.toEqual({ lat: '7.88', lng: '98.39' });
	});

	it('maps permission denied to GeolocationUnavailableError', async () => {
		vi.stubGlobal('navigator', {
			geolocation: {
				getCurrentPosition: (_success: PositionCallback, error?: PositionErrorCallback) => {
					error?.({
						code: 1,
						PERMISSION_DENIED: 1,
						POSITION_UNAVAILABLE: 2,
						TIMEOUT: 3,
						message: 'denied'
					} as GeolocationPositionError);
				}
			}
		});
		stubSecureContext(true);
		stubPolicy(true);

		await expect(requestUserPosition()).rejects.toBeInstanceOf(GeolocationUnavailableError);
		await expect(requestUserPosition()).rejects.toMatchObject({ reason: 'denied' });
	});
});
