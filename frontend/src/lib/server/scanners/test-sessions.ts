/** `_session` userCtx fixtures (real role strings) for scanner admin route tests. */
export const SESSIONS: Record<
	'anonymous' | 'registrationA' | 'managerA' | 'managerAB' | 'kioskA' | 'prA' | 'admin',
	{ name: string | null; roles: string[] }
> = {
	anonymous: { name: null, roles: [] },
	registrationA: { name: 'reg-a', roles: ['shelter:SH001', 'SH001:registration_staff'] },
	managerA: { name: 'sm-a', roles: ['shelter:SH001', 'SH001:shelter_manager'] },
	managerAB: {
		name: 'sm-ab',
		roles: ['shelter:SH001', 'shelter:SH002', 'SH001:shelter_manager', 'SH002:shelter_manager']
	},
	kioskA: { name: 'kiosk-a', roles: ['shelter:SH001', 'SH001:kiosk_staff'] },
	prA: { name: 'pr-a', roles: ['shelter:SH001', 'SH001:pr_staff'] },
	admin: { name: 'sa-user', roles: ['system_admin'] }
};
