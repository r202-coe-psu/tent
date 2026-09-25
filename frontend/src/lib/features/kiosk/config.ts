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
export { isKioskPhoneCheckInEnabled } from './domain/kiosk-config';
