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

/**
 * Domain colour families — one work domain = one colour family, identical on the public site and
 * the staff app (owner-approved "domain color tokens").
 *
 * Steps: `base` = identity / icons / large text; `strong` = solid button background with white
 * text (WCAG AA); `subtle` = soft background; `border` = 360° tinted border; `text` = text on
 * `subtle`. The `text` step doubles as the solid-button hover colour (hover:bg-domain-<id>-text).
 *
 * Domain colours must NEVER express status (critical red, warning amber, operational green, EOC
 * purple stay reserved) — pair every domain colour with a label or icon.
 *
 * CSS twin: `--domain-<id>[-strong|-subtle|-border|-text]` in app.css (a unit test keeps them equal;
 * `registration` base/strong reference `var(--primary)` there, which is the same #124481).
 */
export const baseDomain = {
	registration: {
		name: 'ทะเบียนและศูนย์พักพิง',
		base: '#124481',
		strong: '#124481',
		subtle: '#E4F0FF',
		border: '#BFD4F2',
		text: '#0B2647'
	},
	donation: {
		name: 'บริจาค พัสดุและคลัง',
		base: '#FF5C00',
		strong: '#C2410C',
		subtle: '#FFF3EB',
		border: '#FED7AA',
		text: '#9A3412'
	},
	volunteer: {
		name: 'จิตอาสา',
		base: '#059669',
		strong: '#047857',
		subtle: '#ECFDF5',
		border: '#A7F3D0',
		text: '#065F46'
	},
	kitchen: {
		name: 'ครัว',
		base: '#DB2777',
		strong: '#BE185D',
		subtle: '#FDF2F8',
		border: '#FBCFE8',
		text: '#9D174D'
	},
	facility: {
		name: 'อาคารสถานที่',
		base: '#0D9488',
		strong: '#0F766E',
		subtle: '#F0FDFA',
		border: '#99F6E4',
		text: '#134E4A'
	},
	security: {
		name: 'ความปลอดภัย',
		base: '#7C3AED',
		strong: '#6D28D9',
		subtle: '#F5F3FF',
		border: '#DDD6FE',
		text: '#5B21B6'
	},
	admin: {
		name: 'บริหารและส่วนกลาง',
		base: '#475569',
		strong: '#334155',
		subtle: '#F1F5F9',
		border: '#CBD5E1',
		text: '#1E293B'
	}
} as const;

export type DomainId = keyof typeof baseDomain;

/** Domain ids in display order. */
export const DOMAIN_IDS = Object.keys(baseDomain) as DomainId[];

/** The CSS custom-property name (`var(--domain-…)`) for a domain step; `base` has no suffix. */
export function domainVar(
	id: DomainId,
	step: 'base' | 'strong' | 'subtle' | 'border' | 'text' = 'base'
) {
	return step === 'base' ? `var(--domain-${id})` : `var(--domain-${id}-${step})`;
}

// DEPRECATED(domain-color-tokens): use colors.domain.<id> / --domain-<id> — remove after usages migrate
/**
 * @deprecated use `colors.domain.<id>` / `--domain-<id>`.
 * kitchen -> kitchen domain; inventory + donor -> donation domain; volunteer -> volunteer domain.
 * `family` (rose) is not a work domain and stays as is.
 */
export const baseOperations = {
	kitchen: {
		hex: baseDomain.kitchen.base,
		bg: 'bg-domain-kitchen-subtle',
		text: 'text-domain-kitchen-text',
		border: 'border-domain-kitchen-border',
		dot: 'bg-domain-kitchen'
	},
	family: {
		hex: '#E11D48',
		bg: 'bg-rose-50',
		text: 'text-rose-900',
		border: 'border-rose-200',
		dot: 'bg-rose-600'
	},
	donor: {
		hex: baseDomain.donation.base,
		bg: 'bg-domain-donation-subtle',
		text: 'text-domain-donation-text',
		border: 'border-domain-donation-border',
		dot: 'bg-domain-donation'
	},
	volunteer: {
		hex: baseDomain.volunteer.base,
		bg: 'bg-domain-volunteer-subtle',
		text: 'text-domain-volunteer-text',
		border: 'border-domain-volunteer-border',
		dot: 'bg-domain-volunteer'
	},
	inventory: {
		hex: baseDomain.donation.base,
		bg: 'bg-domain-donation-subtle',
		text: 'text-domain-donation-text',
		border: 'border-domain-donation-border',
		dot: 'bg-domain-donation'
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

	// 4a. Work-domain colour families (same on public site + staff app) — see `baseDomain`
	domain: {
		registration: {
			id: 'registration',
			...baseDomain.registration,
			badge:
				'border border-domain-registration-border bg-domain-registration-subtle text-domain-registration-text font-semibold',
			card: 'border border-domain-registration-border bg-white shadow-2xs hover:border-domain-registration transition-all',
			solid:
				'bg-domain-registration-strong text-white hover:bg-domain-registration-text focus-visible:ring-domain-registration-strong',
			subtleBtn:
				'border border-domain-registration-border bg-domain-registration-subtle text-domain-registration-text hover:bg-white',
			iconBox:
				'border border-domain-registration-border bg-domain-registration-subtle text-domain-registration'
		},
		donation: {
			id: 'donation',
			...baseDomain.donation,
			badge:
				'border border-domain-donation-border bg-domain-donation-subtle text-domain-donation-text font-semibold',
			card: 'border border-domain-donation-border bg-white shadow-2xs hover:border-domain-donation transition-all',
			solid:
				'bg-domain-donation-strong text-white hover:bg-domain-donation-text focus-visible:ring-domain-donation-strong',
			subtleBtn:
				'border border-domain-donation-border bg-domain-donation-subtle text-domain-donation-text hover:bg-white',
			iconBox: 'border border-domain-donation-border bg-domain-donation-subtle text-domain-donation'
		},
		volunteer: {
			id: 'volunteer',
			...baseDomain.volunteer,
			badge:
				'border border-domain-volunteer-border bg-domain-volunteer-subtle text-domain-volunteer-text font-semibold',
			card: 'border border-domain-volunteer-border bg-white shadow-2xs hover:border-domain-volunteer transition-all',
			solid:
				'bg-domain-volunteer-strong text-white hover:bg-domain-volunteer-text focus-visible:ring-domain-volunteer-strong',
			subtleBtn:
				'border border-domain-volunteer-border bg-domain-volunteer-subtle text-domain-volunteer-text hover:bg-white',
			iconBox:
				'border border-domain-volunteer-border bg-domain-volunteer-subtle text-domain-volunteer'
		},
		kitchen: {
			id: 'kitchen',
			...baseDomain.kitchen,
			badge:
				'border border-domain-kitchen-border bg-domain-kitchen-subtle text-domain-kitchen-text font-semibold',
			card: 'border border-domain-kitchen-border bg-white shadow-2xs hover:border-domain-kitchen transition-all',
			solid:
				'bg-domain-kitchen-strong text-white hover:bg-domain-kitchen-text focus-visible:ring-domain-kitchen-strong',
			subtleBtn:
				'border border-domain-kitchen-border bg-domain-kitchen-subtle text-domain-kitchen-text hover:bg-white',
			iconBox: 'border border-domain-kitchen-border bg-domain-kitchen-subtle text-domain-kitchen'
		},
		facility: {
			id: 'facility',
			...baseDomain.facility,
			badge:
				'border border-domain-facility-border bg-domain-facility-subtle text-domain-facility-text font-semibold',
			card: 'border border-domain-facility-border bg-white shadow-2xs hover:border-domain-facility transition-all',
			solid:
				'bg-domain-facility-strong text-white hover:bg-domain-facility-text focus-visible:ring-domain-facility-strong',
			subtleBtn:
				'border border-domain-facility-border bg-domain-facility-subtle text-domain-facility-text hover:bg-white',
			iconBox: 'border border-domain-facility-border bg-domain-facility-subtle text-domain-facility'
		},
		security: {
			id: 'security',
			...baseDomain.security,
			badge:
				'border border-domain-security-border bg-domain-security-subtle text-domain-security-text font-semibold',
			card: 'border border-domain-security-border bg-white shadow-2xs hover:border-domain-security transition-all',
			solid:
				'bg-domain-security-strong text-white hover:bg-domain-security-text focus-visible:ring-domain-security-strong',
			subtleBtn:
				'border border-domain-security-border bg-domain-security-subtle text-domain-security-text hover:bg-white',
			iconBox: 'border border-domain-security-border bg-domain-security-subtle text-domain-security'
		},
		admin: {
			id: 'admin',
			...baseDomain.admin,
			badge:
				'border border-domain-admin-border bg-domain-admin-subtle text-domain-admin-text font-semibold',
			card: 'border border-domain-admin-border bg-white shadow-2xs hover:border-domain-admin transition-all',
			solid:
				'bg-domain-admin-strong text-white hover:bg-domain-admin-text focus-visible:ring-domain-admin-strong',
			subtleBtn:
				'border border-domain-admin-border bg-domain-admin-subtle text-domain-admin-text hover:bg-white',
			iconBox: 'border border-domain-admin-border bg-domain-admin-subtle text-domain-admin'
		}
	},

	// 4b. Legacy operations (DEPRECATED — repointed to the domain families above; `family` unchanged)
	operations: {
		kitchen: {
			name: 'ครัวกลาง เชื้อเพลิง และบริจาคเสบียง (Kitchen, Energy & Food Supply)',
			...baseOperations.kitchen,
			badge:
				'border border-domain-kitchen-border bg-domain-kitchen-subtle text-domain-kitchen-text font-semibold',
			card: 'border border-domain-kitchen-border bg-white shadow-2xs hover:border-domain-kitchen transition-all'
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
			badge:
				'border border-domain-donation-border bg-domain-donation-subtle text-domain-donation-text font-semibold',
			card: 'border border-domain-donation-border bg-white shadow-2xs hover:border-domain-donation transition-all'
		},
		volunteer: {
			name: 'อาสาสมัครและบุคลากรการแพทย์ (Volunteers & Field Responders)',
			...baseOperations.volunteer,
			badge:
				'border border-domain-volunteer-border bg-domain-volunteer-subtle text-domain-volunteer-text font-semibold',
			card: 'border border-domain-volunteer-border bg-white shadow-2xs hover:border-domain-volunteer transition-all'
		},
		inventory: {
			name: 'มาตรฐานสิ่งของและอัตราส่วน (SPHERE Catalog & Inventory)',
			...baseOperations.inventory,
			badge:
				'border border-domain-donation-border bg-domain-donation-subtle text-domain-donation-text font-semibold',
			card: 'border border-domain-donation-border bg-white shadow-2xs hover:border-domain-donation transition-all'
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
			domain: 'registration',
			hex: baseDomain.registration.base,
			bg: 'bg-white',
			border: 'border-domain-registration-border',
			iconBg: 'bg-domain-registration-subtle',
			iconColor: 'text-domain-registration',
			btnPrimary: 'bg-domain-registration-strong hover:bg-domain-registration-text text-white',
			btnSubtle:
				'bg-domain-registration-subtle text-domain-registration-text hover:bg-white border border-domain-registration-border'
		},
		tracing: {
			id: 'tracing',
			title: 'ผู้พักพิง',
			category: 'Family Tracing & Safety Verification',
			domain: 'registration',
			hex: baseDomain.registration.base,
			bg: 'bg-white',
			border: 'border-domain-registration-border',
			iconBg: 'bg-domain-registration-subtle',
			iconColor: 'text-domain-registration',
			btnPrimary: 'bg-domain-registration-strong hover:bg-domain-registration-text text-white',
			btnSubtle:
				'bg-domain-registration-subtle text-domain-registration-text hover:bg-white border border-domain-registration-border'
		},
		donation: {
			id: 'donation',
			title: 'บริจาค',
			category: 'Donations, Food & Logistics Coordination',
			domain: 'donation',
			hex: baseDomain.donation.base,
			bg: 'bg-white',
			border: 'border-domain-donation-border',
			iconBg: 'bg-domain-donation-subtle',
			iconColor: 'text-domain-donation',
			btnPrimary: 'bg-domain-donation-strong hover:bg-domain-donation-text text-white',
			btnSubtle:
				'bg-domain-donation-subtle text-domain-donation-text hover:bg-white border border-domain-donation-border'
		},
		volunteer: {
			id: 'volunteer',
			title: 'อาสาสมัคร',
			category: 'Field Responders, Medical & Community Volunteers',
			domain: 'volunteer',
			hex: baseDomain.volunteer.base,
			bg: 'bg-white',
			border: 'border-domain-volunteer-border',
			iconBg: 'bg-domain-volunteer-subtle',
			iconColor: 'text-domain-volunteer',
			btnPrimary: 'bg-domain-volunteer-strong hover:bg-domain-volunteer-text text-white',
			btnSubtle:
				'bg-domain-volunteer-subtle text-domain-volunteer-text hover:bg-white border border-domain-volunteer-border'
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
		2: '#0D9488', // chart series (teal) — decoupled from the deprecated operations tokens
		3: baseBrand.primary,
		4: baseStatus.warning.hex,
		5: '#EA580C' // chart series (orange) — decoupled from the deprecated operations tokens
	}
} as const;

export type ColorTokens = typeof colors;
