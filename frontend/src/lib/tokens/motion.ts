/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Motion, Easing & Tactile Interaction Tokens
 */

export const motion = {
	durations: {
		fast: '100ms', // Hover highlights, micro-clicks
		normal: '150ms', // Dropdown expansions, toggles, badges
		overlay: '200ms', // Dialog fades, drawer slide-ins
		slow: '300ms' // Page transitions, full modal zoom
	},
	easings: {
		snappy: 'cubic-bezier(0.16, 1, 0.3, 1)', // Snappy spring-like deceleration
		standard: 'ease-out'
	},
	classes: {
		buttonInteractive:
			'transition-all duration-150 ease-out active:scale-[0.98] active:duration-75',
		cardInteractive: 'transition-all duration-150 ease-out hover:border-slate-300 hover:shadow-xs',
		dialogIn: 'animate-in fade-in zoom-in-95 duration-150 ease-out',
		backdropIn: 'animate-in fade-in duration-150'
	}
} as const;

export type MotionTokens = typeof motion;
