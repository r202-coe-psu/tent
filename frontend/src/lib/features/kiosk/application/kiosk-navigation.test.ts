import { beforeEach, describe, expect, it, vi } from 'vitest';

const { gotoMock, resolveMock } = vi.hoisted(() => ({
	gotoMock: vi.fn(),
	resolveMock: vi.fn((path: string) => path)
}));

vi.mock('$app/navigation', () => ({ goto: gotoMock }));
vi.mock('$app/paths', () => ({ resolve: resolveMock }));

import { navigateToKioskHome } from './kiosk-navigation';

describe('navigateToKioskHome', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('uses client-side navigation and preserves kiosk context', () => {
		navigateToKioskHome('?shelter_code=SH001');

		expect(resolveMock).toHaveBeenCalledWith('/kiosk?shelter_code=SH001');
		expect(gotoMock).toHaveBeenCalledWith('/kiosk?shelter_code=SH001');
	});
});
