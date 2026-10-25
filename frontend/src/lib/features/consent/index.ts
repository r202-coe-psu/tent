/**
 * Public API of the `consent` feature (PDPA consent block, docs/features/pdpa-consent-block-spec.md).
 * Cross-feature and route code imports ONLY from here; Svelte-free callers use `./server`.
 */
export * from './server';
export {
	ConsentBlockState,
	type ConsentBlockOptions,
	type ConsentGate,
	type ConsentStaff
} from './application/consent-block.svelte';
export { default as ConsentBlock } from './ui/consent-block.svelte';
export { default as ConsentSummary } from './ui/consent-summary.svelte';
