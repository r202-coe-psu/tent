import type { LanguageCode } from '$lib/stores/language.svelte';
import { printKioskLabels } from '../data/kiosk-print.api';
import { volunteerLabelIdentity } from '../domain/volunteer-label';
import { prepareKioskQrImage } from './kiosk-label-print';
import { runKioskPrintFlow, type KioskPrintFlowResult } from './kiosk-print-flow';
import { KIOSK_PRINT_FLOW_I18N } from './kiosk-print-flow.i18n';
import { renderVolunteerLabelPng } from './volunteer-label-image';

export type VolunteerLabelPrintInput = {
	display_name: string;
	volunteer_code: string;
	qr_payload: string;
};

/** What the browser-print fallback sheet needs: the prepared QR plus the label text. */
export type VolunteerLabelSheet = { qrSrc: string; qrSizeMm: number; name: string; badge: string };

/**
 * Render the volunteer role-card label to a PNG and send it to the kiosk printer. `fallbackPrint`
 * runs only when no scanner client answered, and receives the sheet data to render before
 * `window.print()`. `language` words the error shown on screen; the label itself stays Thai.
 */
export async function printVolunteerLabel(
	volunteer: VolunteerLabelPrintInput,
	fallbackPrint: (sheet: VolunteerLabelSheet) => void | Promise<void>,
	language?: LanguageCode
): Promise<KioskPrintFlowResult> {
	let sheet: VolunteerLabelSheet;
	try {
		const qr = await prepareKioskQrImage(volunteer.qr_payload);
		sheet = { qrSrc: qr.src, qrSizeMm: qr.sizeMm, ...volunteerLabelIdentity(volunteer) };
	} catch {
		return { kind: 'error', message: KIOSK_PRINT_FLOW_I18N[language ?? 'th'].renderFailed };
	}
	return runKioskPrintFlow({
		renderLabels: async () => [
			await renderVolunteerLabelPng({ qrSrc: sheet.qrSrc, name: sheet.name, badge: sheet.badge })
		],
		printLabels: printKioskLabels,
		fallbackPrint: () => fallbackPrint(sheet),
		language
	});
}
