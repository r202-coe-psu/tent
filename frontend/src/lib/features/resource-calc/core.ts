/**
 * Runtime-safe public entry point for pure resource-calc adapters.
 *
 * Standalone scripts must import from here instead of the top-level feature barrel, which also
 * exports Svelte UI and application modules that require the SvelteKit runtime.
 */
export { resolveHave, type HaveMapSources, type ShelterHaveSource } from './data/have-map';
export {
	parseDailyCalcRecord,
	DailyCalcReadError,
	type DailyCalcReadErrorKind,
	type PersistedDailyCalc
} from './data/daily-calc.validation';
