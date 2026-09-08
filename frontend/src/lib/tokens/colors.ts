/**
 * SmartShelter Thailand Civic Light Design System v2.4
 * Color Tokens Specification (Minimal, Modern & Clean)
 *
 * ARCHITECTURE PRINCIPLE:
 * Base Primitive Tokens (Tier 1) are the Single Source of Truth.
 * All downstream tokens (Semantic, Domain, Status, Portal Services)
 * derive directly from these primitives. Modifying a base token
 * propagates automatically across the entire design system.
 */

// =========================================================================
// 1. BASE PRIMITIVE TOKENS (Single Source of Truth / รากฐานสีทั้งระบบ)
// =========================================================================

export const baseBrand = {
	primary: '#0A2647', // Brand Navy: Institutional authority, main headers, primary submit
	primaryHover: '#051930',
	primarySubtle: '#F0F4F8',
	primaryBorder: '#CBD5E1',
	primaryForeground: '#FFFFFF'
} as const;

export const baseSecondary = {
	cerulean: '#0284C7', // GovTech Cerulean: Operational secondary actions, alerts, maps, exports
	ceruleanHover: '#0369A1',
	ceruleanSubtle: '#F0F9FF',
	ceruleanBorder: '#BAE6FD',
	ceruleanText: '#075985',
	neutralBorder: '#CBD5E1', // Neutral Secondary: Slate outline for back/cancel
	neutralBg: '#FFFFFF',
	neutralText: '#334155'
} as const;

export const baseDestructive = {
	red: '#DC2626', // Destructive Red: Critical deletion, permanent dismiss, emergency stop/hotline
	redHover: '#B91C1C',
	redSubtle: '#FEF2F2',
	redBorder: '#FECACA',
	redText: '#991B1B'
} as const;

export const baseAccent = {
	iceBlue: '#F0F9FF', // Subtle Ice Blue: Table row selection, feature tags, subtle focus ring
	iceBlueBorder: '#BAE6FD',
	iceBlueText: '#0369A1',
	glow: 'rgba(2, 132, 199, 0.15)'
} as const;

export const baseNeutral = {
	canvas: '#F8FAFC', // Slate-50: Main application background
	surface: '#FFFFFF', // Pure White: Cards, Panels, Modals
	mutedSurface: '#F1F5F9', // Slate-100: Input backgrounds, sub-panels
	subtleBorder: '#E2E8F0', // Slate-200: Razor-thin 1px border
	mediumBorder: '#CBD5E1', // Slate-300: Form field borders
	darkBorder: '#94A3B8' // Slate-400: Focus/Active borders
} as const;

export const baseText = {
	primary: '#0F172A', // Slate-900: High-contrast headings and vital stats
	body: '#334155', // Slate-700: Main operational reading text
	muted: '#64748B', // Slate-500: Helper text, secondary timestamps
	subtle: '#94A3B8', // Slate-400: Field placeholders, disabled icons
	inverse: '#FFFFFF' // Pure White: Text on Brand Navy & solid buttons
} as const;

export const baseOperations = {
	kitchen: {
		hex: '#EA580C',
		bg: 'bg-orange-50',
		text: 'text-orange-900',
		border: 'border-orange-200',
		dot: 'bg-orange-600'
	},
	family: {
		hex: '#E11D48',
		bg: 'bg-rose-50',
		text: 'text-rose-900',
		border: 'border-rose-200',
		dot: 'bg-rose-600'
	},
	donor: {
		hex: baseSecondary.cerulean, // Inherits directly from Secondary Cerulean
		bg: 'bg-sky-50',
		text: 'text-sky-900',
		border: 'border-sky-200',
		dot: 'bg-sky-600'
	},
	volunteer: {
		hex: '#059669',
		bg: 'bg-emerald-50',
		text: 'text-emerald-900',
		border: 'border-emerald-200',
		dot: 'bg-emerald-600'
	},
	inventory: {
		hex: '#0D9488',
		bg: 'bg-teal-50',
		text: 'text-teal-900',
		border: 'border-teal-200',
		dot: 'bg-teal-600'
	}
} as const;

export const baseStatus = {
	operational: {
		hex: '#16A34A',
		bg: 'bg-emerald-50',
		text: 'text-emerald-900',
		border: 'border-emerald-200',
		dot: 'bg-emerald-600'
	},
	warning: {
		hex: '#F59E0B',
		bg: 'bg-amber-50',
		text: 'text-amber-900',
		border: 'border-amber-200',
		dot: 'bg-amber-500'
	},
	critical: {
		hex: baseDestructive.red, // Inherits directly from Destructive Red
		bg: 'bg-red-50',
		text: 'text-red-900',
		border: 'border-red-200',
		dot: 'bg-red-600'
	},
	logistics: {
		hex: baseSecondary.cerulean, // Inherits directly from Secondary Cerulean
		bg: 'bg-sky-50',
		text: 'text-sky-900',
		border: 'border-sky-200',
		dot: 'bg-sky-600'
	},
	eoc: {
		hex: '#9333EA',
		bg: 'bg-purple-50',
		text: 'text-purple-900',
		border: 'border-purple-200',
		dot: 'bg-purple-600'
	}
} as const;

// =========================================================================
// 2. UNIFIED DESIGN SYSTEM TOKENS (Downstream Derived Registry)
// =========================================================================

export const colors = {
	// 1. Brand Foundations
	brand: {
		primary: baseBrand.primary,
		navy: baseBrand.primary, // Backward-compatible alias
		navyHover: baseBrand.primaryHover,
		navySubtle: baseBrand.primarySubtle,
		navyBorder: baseBrand.primaryBorder
	},
	secondary: baseSecondary,
	destructive: baseDestructive,
	accent: baseAccent,
	neutral: baseNeutral,
	text: baseText,

	// 2. Functional UI States (Derived from base)
	functional: {
		accent: {
			name: 'ไฮไลท์แถว / แท็กเน้น (Accent Ice Blue)',
			hex: baseSecondary.cerulean,
			bg: 'bg-sky-50',
			border: 'border-sky-200',
			text: 'text-sky-900',
			badge: 'border border-sky-200 bg-sky-50 text-sky-900 font-semibold'
		},
		warning: {
			name: 'ข้อความเตือน / คำแนะนำ (Warning Advisory)',
			hex: baseStatus.warning.hex,
			bg: baseStatus.warning.bg,
			border: baseStatus.warning.border,
			text: baseStatus.warning.text,
			dot: baseStatus.warning.dot,
			badge: 'border border-amber-200 bg-amber-50 text-amber-900 font-semibold'
		},
		muted: {
			name: 'องค์ประกอบรอง / ปิดใช้งาน (Muted Slate)',
			hex: baseText.muted,
			bg: 'bg-slate-100',
			border: 'border-slate-200',
			text: 'text-slate-600',
			badge: 'border border-slate-200 bg-slate-100 text-slate-700 font-medium'
		}
	},

	// 3. 360-Degree Refined Status Framing Tokens
	status: {
		operational: {
			name: 'ปกติ / พร้อมใช้งาน (Operational)',
			...baseStatus.operational,
			badge: 'border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold',
			card: 'border border-emerald-200 bg-white shadow-2xs hover:border-emerald-300 transition-all'
		},
		warning: {
			name: 'เฝ้าระวัง / ข้อมูลไม่ครบ (Warning)',
			...baseStatus.warning,
			badge: 'border border-amber-200 bg-amber-50 text-amber-900 font-semibold',
			card: 'border border-amber-200 bg-white shadow-2xs hover:border-amber-300 transition-all'
		},
		critical: {
			name: 'วิกฤต / ฉุกเฉินเร่งด่วน (Critical)',
			...baseStatus.critical,
			badge: 'border border-red-200 bg-red-50 text-red-900 font-semibold',
			card: 'border border-red-200 bg-white shadow-2xs hover:border-red-300 transition-all'
		},
		logistics: {
			name: 'ส่งกำลังบำรุง / ขนย้าย (Logistics)',
			...baseStatus.logistics,
			badge: 'border border-sky-200 bg-sky-50 text-sky-900 font-semibold',
			card: 'border border-sky-200 bg-white shadow-2xs hover:border-sky-300 transition-all'
		},
		eoc: {
			name: 'ศูนย์บัญชาการเหตุการณ์ (EOC Command)',
			...baseStatus.eoc,
			badge: 'border border-purple-200 bg-purple-50 text-purple-900 font-semibold',
			card: 'border border-purple-200 bg-white shadow-2xs hover:border-purple-300 transition-all'
		}
	},

	// 4. Domain & Specialized Shelter Operations
	operations: {
		kitchen: {
			name: 'ครัวกลาง เชื้อเพลิง และบริจาคเสบียง (Kitchen, Energy & Food Supply)',
			...baseOperations.kitchen,
			badge: 'border border-orange-200 bg-orange-50 text-orange-900 font-semibold',
			card: 'border border-orange-200 bg-white shadow-2xs hover:border-orange-300 transition-all'
		},
		family: {
			name: 'แม่และเด็ก / สตรีมีครรภ์ (Maternal & Infant Family Care)',
			...baseOperations.family,
			badge: 'border border-rose-200 bg-rose-50 text-rose-900 font-semibold',
			card: 'border border-rose-200 bg-white shadow-2xs hover:border-rose-300 transition-all'
		},
		donor: {
			name: 'ระบบผู้บริจาคและติดตามหาญาติ (Donors, Tracing & Public Relations)',
			...baseOperations.donor,
			badge: 'border border-sky-200 bg-sky-50 text-sky-900 font-semibold',
			card: 'border border-sky-200 bg-white shadow-2xs hover:border-sky-300 transition-all'
		},
		volunteer: {
			name: 'จิตอาสาและบุคลากรการแพทย์ (Volunteers & Field Responders)',
			...baseOperations.volunteer,
			badge: 'border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold',
			card: 'border border-emerald-200 bg-white shadow-2xs hover:border-emerald-300 transition-all'
		},
		inventory: {
			name: 'มาตรฐานสิ่งของและอัตราส่วน (SPHERE Catalog & Inventory)',
			...baseOperations.inventory,
			badge: 'border border-teal-200 bg-teal-50 text-teal-900 font-semibold',
			card: 'border border-teal-200 bg-white shadow-2xs hover:border-teal-300 transition-all'
		}
	},

	// 5. Remote-First CouchDB Sync Indicators
	sync: {
		online: {
			name: 'ออนไลน์ เชื่อมต่อปกติ (Online / Synced)',
			hex: baseStatus.operational.hex,
			bg: baseStatus.operational.bg,
			text: baseStatus.operational.text,
			border: baseStatus.operational.border,
			dot: baseStatus.operational.dot
		},
		syncing: {
			name: 'กำลังส่งข้อมูล (Syncing in Progress)',
			hex: baseSecondary.cerulean,
			bg: baseSecondary.ceruleanSubtle,
			text: 'text-sky-900',
			border: baseSecondary.ceruleanBorder,
			dot: 'bg-sky-500 animate-pulse'
		},
		offline: {
			name: 'ออฟไลน์ ทำงานในพื้นที่ (Offline Mode)',
			hex: baseText.primary,
			bg: 'bg-slate-100',
			text: 'text-slate-800',
			border: 'border-slate-300',
			dot: 'bg-slate-700'
		},
		conflict: {
			name: 'ข้อมูลขัดแย้ง (Sync Conflict Detected)',
			hex: baseDestructive.red,
			bg: baseDestructive.redSubtle,
			text: baseDestructive.redText,
			border: baseDestructive.redBorder,
			dot: 'bg-red-600'
		}
	},

	// 6. Public Portal Essential Services (4 Pillars, FAQ & Emergency Hotline)
	portalServices: {
		shelter: {
			id: 'shelter',
			title: 'ค้นหาที่พักพิง',
			category: 'For Evacuees & Displaced Families',
			hex: baseDestructive.red,
			bg: 'bg-white',
			border: 'border-red-200',
			iconBg: 'bg-red-50',
			iconColor: 'text-red-600',
			btnPrimary: 'bg-red-600 hover:bg-red-700 text-white',
			btnSubtle: 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-100'
		},
		tracing: {
			id: 'tracing',
			title: 'ค้นหาญาติ / ผู้พักพิง',
			category: 'Family Tracing & Safety Verification',
			hex: baseBrand.primary,
			accentHex: baseSecondary.cerulean,
			bg: 'bg-white',
			border: 'border-sky-200',
			iconBg: 'bg-sky-50',
			iconColor: 'text-[#0284C7]',
			btnPrimary: 'bg-[#0A2647] hover:bg-[#051930] text-white',
			btnSubtle: 'bg-sky-50 text-sky-800 hover:bg-sky-100 border border-sky-100'
		},
		donation: {
			id: 'donation',
			title: 'ผู้บริจาค / มอบเสบียง',
			category: 'Donations, Food & Logistics Coordination',
			hex: baseOperations.kitchen.hex,
			bg: 'bg-white',
			border: 'border-amber-200',
			iconBg: 'bg-amber-50',
			iconColor: 'text-amber-600',
			btnPrimary: 'bg-amber-600 hover:bg-amber-700 text-white',
			btnSubtle: 'bg-amber-50 text-amber-800 hover:bg-amber-100 border border-amber-100'
		},
		volunteer: {
			id: 'volunteer',
			title: 'จิตอาสา / อาสาสมัคร',
			category: 'Field Responders, Medical & Community Volunteers',
			hex: baseOperations.volunteer.hex,
			bg: 'bg-white',
			border: 'border-emerald-200',
			iconBg: 'bg-emerald-50',
			iconColor: 'text-emerald-600',
			btnPrimary: 'bg-emerald-600 hover:bg-emerald-700 text-white',
			btnSubtle: 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-100'
		},
		faq: {
			activeBorder: 'border-blue-300',
			activeBadge: 'bg-[#0A2647] text-white',
			inactiveBorder: 'border-slate-200',
			inactiveBadge: 'bg-slate-100 text-slate-600'
		},
		emergency: {
			hotlineHex: baseDestructive.red,
			hotlineBg: 'bg-red-600 hover:bg-red-700 text-white',
			alertHex: baseSecondary.cerulean,
			alertBg: 'bg-[#0284C7] hover:bg-[#0369a1] text-white'
		}
	},

	// 7. Data Visualization & Analytics Charts
	chart: {
		1: baseSecondary.cerulean,
		2: baseOperations.inventory.hex,
		3: baseBrand.primary,
		4: baseStatus.warning.hex,
		5: baseOperations.kitchen.hex
	}
} as const;

export type ColorTokens = typeof colors;
