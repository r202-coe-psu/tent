/**
 * Department-based portal home (`/portal`). The only entry point other code may import: the menu
 * UI and the feature-availability type the route feeds it. Menu data and the pure visibility
 * filter stay internal to the feature.
 */
export type { PortalFeatures } from './domain/portal-menu';
export { default as PortalMenuSections } from './ui/portal-menu.svelte';
