export {
	GRANTABLE_SCOPES,
	PARTNER_MODULES,
	PARTNER_MODULE_LABEL,
	SCOPE_LABEL,
	createThirdPartyClientSchema,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	revealThirdPartyClientSecretSchema,
	thirdPartyClientDisplayName,
	updateThirdPartyClientScopesSchema,
	type CreateThirdPartyClientInput,
	type CreatedThirdPartyClient,
	type GrantableScope,
	type PartnerModule,
	type RevealThirdPartyClientSecretInput,
	type ThirdPartyClient,
	type UpdateThirdPartyClientScopesInput
} from './domain/third-party-client';
export {
	createThirdPartyClient,
	deleteThirdPartyClient,
	listThirdPartyClients,
	regenerateThirdPartyClientSecret,
	revealThirdPartyClientSecret,
	revokeThirdPartyClient,
	updateThirdPartyClientScopes
} from './data/third-party-clients.api';
export {
	thirdPartyClientsKeys,
	useCreateThirdPartyClient,
	useDeleteThirdPartyClient,
	useRegenerateThirdPartyClientSecret,
	useRevealThirdPartyClientSecret,
	useRevokeThirdPartyClient,
	useThirdPartyClients,
	useUpdateThirdPartyClientScopes
} from './application/queries';
export { default as ThirdPartyClientList } from './ui/third-party-client-list.svelte';
export { default as CreateThirdPartyClientDialog } from './ui/create-third-party-client-dialog.svelte';
export { default as RevealThirdPartyClientSecretDialog } from './ui/reveal-third-party-client-secret-dialog.svelte';
export { default as RevokeThirdPartyClientDialog } from './ui/revoke-third-party-client-dialog.svelte';
export { default as EditThirdPartyClientScopesDialog } from './ui/edit-third-party-client-scopes-dialog.svelte';
export { default as ViewThirdPartyClientSecretDialog } from './ui/view-third-party-client-secret-dialog.svelte';
export { default as DeleteThirdPartyClientDialog } from './ui/delete-third-party-client-dialog.svelte';
export { default as RegenerateThirdPartyClientSecretDialog } from './ui/regenerate-third-party-client-secret-dialog.svelte';
