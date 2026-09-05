/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Responsive Breakpoints, Device Stacking & Touch Target Tokens
 */

export const responsive = {
	breakpoints: {
		sm: '640px', // Mobile boundary
		md: '768px', // Field Tablet Portrait
		lg: '1024px', // Field Tablet Landscape / Small Laptop
		xl: '1280px', // Desktop EOC
		'2xl': '1536px' // Command Center Wide Wall Display
	},
	touchTargets: {
		mobileMin: 'min-h-11 min-w-11', // 44px: Standard mobile tap target
		fieldTabletMin: 'min-h-12 min-w-12', // 48px: Field tablet with gloves/stylus
		buttonMobile: 'h-11 px-4 text-xs font-semibold',
		buttonTablet: 'h-12 px-5 text-sm font-semibold',
		buttonDesktop: 'h-10 px-4 text-xs font-semibold'
	},
	gridMatrices: {
		kpiTelemetry: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6',
		formTwoCol: 'grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5',
		masterDetailSplit: {
			container: 'grid grid-cols-1 lg:grid-cols-12 gap-5',
			masterList: 'lg:col-span-5',
			detailPanel: 'lg:col-span-7'
		}
	}
} as const;

export type ResponsiveTokens = typeof responsive;
