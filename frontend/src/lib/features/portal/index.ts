/**
 * Department-based portal home (`/portal`). The only entry point other code may import: the menu
 * UI, the system-admin role preview, and the feature-availability type the route feeds them.
 * Menu data and the pure visibility filters stay internal to the feature.
 */
export type { PortalFeatures } from './domain/portal-menu';
export {
	createPortalPreviewState,
	resolvePortalPreview,
	type PortalPreviewState
} from './domain/portal-preview';
export { default as PortalMenuSections } from './ui/portal-menu.svelte';
export { default as PortalRolePreview } from './ui/portal-role-preview.svelte';
