/**
 * SSR-safe kiosk configuration entry point.
 * Keep server routes away from the UI barrel, which re-exports Svelte components
 * and pulls the CommonJS `qrcode` package into Vite's SSR module graph.
 */
export {
	fetchKioskConfig,
	KIOSK_CONFIG_TIMEOUT_MS,
	type KioskConfig
} from './data/kiosk-config.api';
export {
	isKioskPhoneCheckInEnabled,
	isKioskThaidCheckInEnabled,
	isKioskWalkInRegistrationEnabled
} from './domain/kiosk-config';
export {
	buildKioskContextQuery,
	getKioskDisplayContext,
	KIOSK_DISPLAY_QUERY_KEYS,
	readKioskDisplayQuery,
	type KioskDisplayContext,
	type KioskDisplayQuery,
	type KioskDisplayQueryKey
} from './domain/display-context';
