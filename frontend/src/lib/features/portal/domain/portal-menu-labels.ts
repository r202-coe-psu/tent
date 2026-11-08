/**
 * English mirror of the portal menu copy (departments, tiles, group captions, footer link).
 * `portal-menu.ts` stays the Thai source of truth; this file only adds the EN text, keyed by the
 * same ids, so the domain stays free of any language state — callers pass the language in
 * (precedent: `policyLabelsByLanguage` in the shelters feature).
 */
import {
	PORTAL_GROUP_LABELS,
	PORTAL_PUBLIC_LINK,
	type PortalDepartment,
	type PortalMenuItem
} from './portal-menu';

export type PortalText = { label: string; desc: string };

const departmentsEn: Record<PortalDepartment['id'], PortalText> = {
	registration: {
		label: 'Registration',
		desc: 'Register, screen and allocate evacuees to zones'
	},
	kitchen: { label: 'Kitchen', desc: 'Meal planning and ingredient requisitions' },
	supply: { label: 'Supplies and Warehouse', desc: 'Warehouse, donations and distribution' },
	volunteer: { label: 'Volunteers', desc: 'Volunteer work, shifts and check-in' },
	security: { label: 'Security', desc: 'Incidents and entry/exit points' },
	facility: { label: 'Facilities', desc: 'Zones, tents and utilities' },
	management: {
		label: 'Shelter Management',
		desc: 'Overview, users and shelter settings'
	},
	pr: { label: 'Public Relations', desc: 'News and announcements on the shelter kiosks' },
	central: { label: 'Central', desc: 'For central system administrators only' }
};

const itemsEn: Record<string, PortalText> = {
	'station-1': {
		label: 'Register Families and Households',
		desc: 'Record evacuees and families and issue QR cards'
	},
	'station-2': {
		label: 'Occupant Screening',
		desc: 'Screen symptoms and vulnerable groups before zoning'
	},
	'station-3': {
		label: 'Zone Allocation',
		desc: 'Assign evacuees to zones and tents'
	},
	'evacuee-search-edit': {
		label: 'Search and Edit Evacuee Records',
		desc: 'Search by name or ID number'
	},
	'scan-check-in-out': { label: 'Scan Entry / Exit', desc: 'Record daily entries and exits' },
	'evacuee-database': {
		label: 'Evacuee Database',
		desc: 'Evacuees and households across the shelter'
	},
	'kitchen-hub': { label: 'Central Kitchen and Meals', desc: 'Meal plans and service' },
	'kitchen-requisition': {
		label: 'Kitchen Ingredient Requisition',
		desc: 'Requisitions for ingredients and food supplies'
	},
	warehouse: { label: 'Warehouse and Stock', desc: 'Receive, issue and count stock' },
	'stock-donations': {
		label: 'Receive Donations',
		desc: 'Receive donated goods into the warehouse'
	},
	'supply-distribution': {
		label: 'Issue Supplies and Food',
		desc: 'Requisitions from each department'
	},
	'supply-kitchen-requisition': {
		label: 'Kitchen Ingredient Requisition',
		desc: 'Requisitions for ingredients and food supplies'
	},
	'frontline-distribution': {
		label: 'Supplies and Food Distribution Point',
		desc: 'Hand out goods per household onsite'
	},
	'volunteer-management': {
		label: 'Manage Volunteers and Shifts',
		desc: 'Post tasks and schedule shifts'
	},
	'volunteer-check-in': {
		label: 'Volunteer Shift Check-in',
		desc: 'Handle arrivals at the shelter entrance'
	},
	'security-incidents': { label: 'Security and Incidents', desc: 'Log unsafe events' },
	'zone-settings': {
		label: 'Zone Settings',
		desc: 'Set zones, capacity, type and open/closed status'
	},
	'shelter-manage': {
		label: 'Manage Shelter and Zones',
		desc: 'All shelter and zone information'
	},
	'shelter-readiness': { label: 'Shelter Readiness', desc: 'Assess readiness daily' },
	'shelter-users': { label: 'Shelter Users', desc: 'Accounts and roles in the shelter' },
	'kiosk-devices': {
		label: 'Manage Kiosks',
		desc: 'Shelter kiosks and staff PINs'
	},
	referrals: {
		label: 'Evacuee Referrals',
		desc: 'Refer to a hospital or another shelter'
	},
	'back-office': { label: 'Back Office', desc: 'Shelter settings and reports' },
	'kiosk-banners': {
		label: 'Kiosk News',
		desc: 'Manage public-relations banners on the kiosks'
	},
	'system-management': {
		label: 'Central System Settings',
		desc: 'All shelters and all users in the system'
	}
};

const groupLabelsEn: Record<NonNullable<PortalMenuItem['group']>, string> = {
	stations: 'Onsite stations',
	tools: 'Registration tools'
};

const publicLinkEn = 'Public service website';

export type PortalLanguage = string | undefined;

const isEn = (language: PortalLanguage) => language === 'en';

/** Department heading + description in the requested language (Thai unless `en`). */
export function portalDepartmentText(
	department: Pick<PortalDepartment, 'id' | 'label' | 'desc'>,
	language?: PortalLanguage
): PortalText {
	if (!isEn(language)) return { label: department.label, desc: department.desc };
	return departmentsEn[department.id] ?? { label: department.label, desc: department.desc };
}

/** Tile label + description in the requested language (Thai unless `en`). */
export function portalItemText(
	item: Pick<PortalMenuItem, 'id' | 'label' | 'desc'>,
	language?: PortalLanguage
): PortalText {
	if (!isEn(language)) return { label: item.label, desc: item.desc };
	return itemsEn[item.id] ?? { label: item.label, desc: item.desc };
}

/** Caption of a department sub-section (registration stations / tools). */
export function portalGroupLabel(
	group: NonNullable<PortalMenuItem['group']>,
	language?: PortalLanguage
): string {
	return isEn(language) ? groupLabelsEn[group] : PORTAL_GROUP_LABELS[group];
}

/** Footer public-site link label. */
export function portalPublicLinkLabel(language?: PortalLanguage): string {
	return isEn(language) ? publicLinkEn : PORTAL_PUBLIC_LINK.label;
}

/** EN mirrors keyed by id — exposed for coverage tests. */
export const portalMenuLabelsEn = {
	departments: departmentsEn,
	items: itemsEn,
	groups: groupLabelsEn,
	publicLink: publicLinkEn
};
