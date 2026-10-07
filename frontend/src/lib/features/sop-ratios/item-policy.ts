// Narrow UI entry for the operations item detail panel. Kept apart from `components.ts`
// because that barrel re-exports food-sphere-stock-tab, which imports `operations` — importing
// it from `operations` would create a cycle.
export { default as ItemPolicyPanel } from './ui/item-policy-panel.svelte';
