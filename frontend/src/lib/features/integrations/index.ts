// Public API of the shared integration health gate (draft CR — referral M5 §2, central warehouse M6 §4).
export * from './domain/integration-status';
export { useIntegrationStatus, integrationKeys } from './application/integration-queries';
export { fetchIntegrationStatus } from './data/integration-status.remote';
export { default as IntegrationGateAlert } from './ui/integration-gate-alert.svelte';
