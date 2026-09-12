/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Typography Tokens Specification (Minimal, Modern & Clean)
 */

export const typography = {
	fonts: {
		sans: "'IBM Plex Sans Thai', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		mono: "'Geist Mono', 'Fira Code', 'SF Mono', Consolas, monospace"
	},
	scale: {
		h1: {
			name: 'Page Title (H1)',
			size: '2.25rem - 2.5rem (36px - 40px)',
			weight: '800 (Extrabold)',
			lineHeight: '1.2 (tight)',
			classes: 'text-3xl sm:text-4xl font-extrabold text-[#0A2647] tracking-tight'
		},
		h2: {
			name: 'Section Header (H2)',
			size: '1.5rem - 1.75rem (24px - 28px)',
			weight: '700 (Bold)',
			lineHeight: '1.25 (snug)',
			classes: 'text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight'
		},
		h3: {
			name: 'Card / Modal Title (H3)',
			size: '1.125rem - 1.25rem (18px - 20px)',
			weight: '700 (Bold)',
			lineHeight: '1.3',
			classes: 'text-lg sm:text-xl font-bold text-slate-900'
		},
		h4: {
			name: 'Group Title (H4)',
			size: '0.9375rem - 1rem (15px - 16px)',
			weight: '600 (Semibold)',
			lineHeight: '1.4',
			classes: 'text-base font-semibold text-slate-800'
		},
		lead: {
			name: 'Field Reading Lead Text (p.lead)',
			size: '1.125rem (18px)',
			weight: '500 (Medium)',
			lineHeight: '1.625 (relaxed)',
			classes: 'text-lg text-slate-700 leading-relaxed font-medium'
		},
		body: {
			name: 'Standard Body Text (p)',
			size: '1rem (16px)',
			weight: '400 (Normal)',
			lineHeight: '1.5 (normal)',
			classes: 'text-base text-slate-700 leading-normal font-normal'
		},
		small: {
			name: 'Helper / Timestamp Text (p.small)',
			size: '0.875rem (14px)',
			weight: '400 (Normal)',
			lineHeight: '1.4',
			classes: 'text-sm text-slate-500 leading-normal font-normal'
		},
		label: {
			name: 'Form Control Label (label)',
			size: '0.875rem (14px)',
			weight: '600 (Semibold)',
			lineHeight: '1.25',
			classes: 'text-sm font-semibold text-slate-700'
		},
		badge: {
			name: 'Status Badge Text (span.badge)',
			size: '0.75rem (12px)',
			weight: '600 (Semibold)',
			lineHeight: '1',
			classes: 'text-xs font-semibold tracking-wide'
		},
		metric: {
			name: 'Telemetry Metric Number (.metric-lg)',
			size: '2.25rem - 2.75rem (36px - 44px)',
			weight: '700 (Bold)',
			lineHeight: '1',
			classes: 'text-3xl sm:text-4xl font-bold text-slate-900 tabular-nums'
		}
	}
} as const;

export type TypographyTokens = typeof typography;
