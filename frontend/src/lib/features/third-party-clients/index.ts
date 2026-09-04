export {
	GRANTABLE_SCOPES,
	PARTNER_MODULES,
	PARTNER_MODULE_LABEL,
	SCOPE_LABEL,
	createThirdPartyClientSchema,
	normalizeRevokedThirdPartyClient,
	normalizeThirdPartyClientList,
	type CreateThirdPartyClientInput,
	type CreatedThirdPartyClient,
	type GrantableScope,
	type PartnerModule,
	type ThirdPartyClient
} from './domain/third-party-client';
export {
	createThirdPartyClient,
	listThirdPartyClients,
	revokeThirdPartyClient
} from './data/third-party-clients.api';
export {
	thirdPartyClientsKeys,
	useCreateThirdPartyClient,
	useRevokeThirdPartyClient,
	useThirdPartyClients
} from './application/queries';
export { default as ThirdPartyClientList } from './ui/third-party-client-list.svelte';
export { default as CreateThirdPartyClientDialog } from './ui/create-third-party-client-dialog.svelte';
export { default as RevealThirdPartyClientSecretDialog } from './ui/reveal-third-party-client-secret-dialog.svelte';
export { default as RevokeThirdPartyClientDialog } from './ui/revoke-third-party-client-dialog.svelte';
