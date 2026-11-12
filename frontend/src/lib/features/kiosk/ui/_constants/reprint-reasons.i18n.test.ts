import { describe, expect, it } from 'vitest';
import { REPRINT_SESSION_I18N } from '../../application/reprint-session.i18n';
import { reprintUnavailableReason } from '../../domain/check-in-status';
import { KIOSK_REPRINT_I18N } from './kiosk-reprint.i18n';

describe('reprint reasons', () => {
	it.each(['th', 'en'] as const)(
		'read the same in the member list and the session (%s)',
		(lang) => {
			const list = KIOSK_REPRINT_I18N[lang].memberList;
			const session = REPRINT_SESSION_I18N[lang];

			expect(list.preRegisteredReason).toBe(reprintUnavailableReason('pre_registered', lang));
			expect(list.temporaryLeaveReason).toBe(reprintUnavailableReason('temporary_leave', lang));
			expect(session.blockedPreRegistered).toBe(reprintUnavailableReason('pre_registered', lang));
		}
	);
});
