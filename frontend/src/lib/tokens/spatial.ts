/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Spatial, Geometry, Radius & Elevation Tokens Specification
 */

export const spatial = {
	container: {
		page: 'mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-10 sm:py-16 space-y-12 sm:space-y-16',
		card: 'rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs',
		section: 'rounded-2xl border border-slate-200/80 bg-white p-6 sm:p-10 shadow-2xs space-y-6',
		modal: 'rounded-2xl border border-slate-200/80 bg-white p-6 shadow-md max-w-lg w-full'
	},
	spacing: {
		sectionGap: 'space-y-12 sm:space-y-16', // 48px - 64px between page blocks
		sectionPadding: 'p-6 sm:p-10', // 24px mobile, 40px desktop inner section
		cardPadding: 'p-4 sm:p-5', // 16px - 20px card inner padding
		gridGutters: 'gap-4 sm:gap-6', // 16px - 24px between grid tiles
		formFieldGap: 'space-y-4 sm:space-y-5', // 16px - 20px between input groups
		labelGap: 'space-y-1.5' // 6px between label and input box
	},
	radius: {
		sm: 'rounded-md', // 6px: Small badges, kbd keys
		md: 'rounded-lg', // 8px: Standard form inputs, buttons, select boxes
		lg: 'rounded-xl', // 12px: Dashboard KPI cards, telemetry tiles, list items
		xl: 'rounded-2xl', // 16px: Main page sections, dialog modals, command palette
		full: 'rounded-full' // 9999px: Status pills, avatar badges, toggle switches
	},
	elevation: {
		level0: 'shadow-none', // Flat controls (inputs, secondary badges)
		level1: 'shadow-2xs', // Default card surface: 0 1px 2px 0 rgba(15,23,42,0.03)
		level2: 'shadow-xs', // Hover state & floating toolbar: 0 1px 2px 0 rgba(15,23,42,0.04)
		level3: 'shadow-md', // Modals, Dialogs, Dropdown Popovers
		level4: 'shadow-2xl' // Command Palette overlay
	},
	borders: {
		subtle: 'border border-slate-200/80', // Crisp 1px card boundary
		control: 'border border-slate-300', // Standard input & select border
		focus: 'ring-2 ring-slate-900 ring-offset-2', // High-contrast a11y focus ring
		statusEmerald: 'border border-emerald-200',
		statusAmber: 'border border-amber-200',
		statusRed: 'border border-red-200',
		statusSky: 'border border-sky-200',
		statusPurple: 'border border-purple-200'
	}
} as const;

export type SpatialTokens = typeof spatial;
