import type { Component } from 'svelte';
import Ambulance from '@lucide/svelte/icons/ambulance';
import Building from '@lucide/svelte/icons/building';
import Building2 from '@lucide/svelte/icons/building-2';
import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
import ClipboardList from '@lucide/svelte/icons/clipboard-list';
import Database from '@lucide/svelte/icons/database';
import Globe from '@lucide/svelte/icons/globe';
import HandHeart from '@lucide/svelte/icons/hand-heart';
import Heart from '@lucide/svelte/icons/heart';
import HeartHandshake from '@lucide/svelte/icons/heart-handshake';
import HeartPulse from '@lucide/svelte/icons/heart-pulse';
import House from '@lucide/svelte/icons/house';
import MapPin from '@lucide/svelte/icons/map-pin';
import Monitor from '@lucide/svelte/icons/monitor';
import Package from '@lucide/svelte/icons/package';
import PackageCheck from '@lucide/svelte/icons/package-check';
import ScanLine from '@lucide/svelte/icons/scan-line';
import Search from '@lucide/svelte/icons/search';
import Settings from '@lucide/svelte/icons/settings';
import Shield from '@lucide/svelte/icons/shield';
import ShieldAlert from '@lucide/svelte/icons/shield-alert';
import Stethoscope from '@lucide/svelte/icons/stethoscope';
import Tent from '@lucide/svelte/icons/tent';
import UserCheck from '@lucide/svelte/icons/user-check';
import UserCog from '@lucide/svelte/icons/user-cog';
import Users from '@lucide/svelte/icons/users';
import Utensils from '@lucide/svelte/icons/utensils';
import UtensilsCrossed from '@lucide/svelte/icons/utensils-crossed';
import type { PortalIconKey } from '../domain/portal-menu';

export const PORTAL_ICONS: Record<PortalIconKey, Component<{ class?: string }>> = {
	ambulance: Ambulance,
	building: Building,
	'building-2': Building2,
	'clipboard-check': ClipboardCheck,
	'clipboard-list': ClipboardList,
	database: Database,
	globe: Globe,
	'hand-heart': HandHeart,
	heart: Heart,
	'heart-handshake': HeartHandshake,
	'heart-pulse': HeartPulse,
	house: House,
	'map-pin': MapPin,
	monitor: Monitor,
	package: Package,
	'package-check': PackageCheck,
	'scan-line': ScanLine,
	search: Search,
	settings: Settings,
	shield: Shield,
	'shield-alert': ShieldAlert,
	stethoscope: Stethoscope,
	tent: Tent,
	'user-check': UserCheck,
	'user-cog': UserCog,
	users: Users,
	utensils: Utensils,
	'utensils-crossed': UtensilsCrossed
};
