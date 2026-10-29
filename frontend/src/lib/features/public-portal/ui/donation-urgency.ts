import type { DonationNeedUrgency } from '../domain/donation-map';

/**
 * One colour per urgency, shared by the map pin, its number badge and the legend so a
 * pin and its card always read the same. They match the board's own red/orange/green
 * urgency marks and differ in lightness as well as hue; orange carries dark text because
 * white on it is unreadable.
 */
export const DONATION_URGENCY_STYLE: Record<
	DonationNeedUrgency,
	{ fill: string; text: string; badge: string; chip: string }
> = {
	critical: {
		fill: '#DC2626',
		text: '#FFFFFF',
		badge: 'bg-red-600 text-white',
		chip: 'border-red-200 bg-red-50 text-red-700'
	},
	high: {
		fill: '#F97316',
		text: '#431407',
		badge: 'bg-orange-500 text-orange-950',
		chip: 'border-orange-200 bg-orange-50 text-orange-700'
	},
	normal: {
		fill: '#047857',
		text: '#FFFFFF',
		badge: 'bg-emerald-700 text-white',
		chip: 'border-emerald-200 bg-emerald-50 text-emerald-700'
	}
};

export const DONATION_URGENCY_ORDER: DonationNeedUrgency[] = ['critical', 'high', 'normal'];
