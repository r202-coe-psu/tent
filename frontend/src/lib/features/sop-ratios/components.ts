// UI-component barrel for the sop-ratios feature.
// Import Svelte components from this file; domain types/hooks come from ./index.ts

export { default as ResourceDashboard } from './ui/resource-dashboard.svelte';
export { default as SopTypeList } from './ui/sop-type-list.svelte';
export type { SopTabType } from './ui/sop-type-list.svelte';
export { default as SopRatioTab } from './ui/sop-ratio-tab.svelte';
export { default as SopEditForm } from './ui/sop-edit-form.svelte';
export { default as AlertThresholdStub } from './ui/alert-threshold-stub.svelte';
export { default as VersionHistoryDrawer } from './ui/version-history-drawer.svelte';
export { default as DeactivateConfirmDialog } from './ui/deactivate-confirm-dialog.svelte';
