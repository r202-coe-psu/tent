import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceFetch = vi.hoisted(() => vi.fn());
vi.mock('$lib/api/service', () => ({ serviceFetch }));

import { createUser, deleteUser, listUsers, updateUser } from './users.api';

// The BFF checks the manager role in `?shelter_code=` and a manager of several shelters must name
// one (#477), so every users call carries the shelter the caller works in.
describe('users api names the shelter it works in (#477)', () => {
	beforeEach(() => {
		serviceFetch.mockReset().mockResolvedValue({ ok: true });
	});

	const created = { name: 'staff01', password: 'x', display_name: 'S', roles: ['shelter:SH002'] };

	it('lists with ?shelter_code=', async () => {
		await listUsers('SH002');
		expect(serviceFetch).toHaveBeenCalledWith('/api/v1/users?shelter_code=SH002');
	});

	it('creates and updates with ?shelter_code=, keeping the body free of it', async () => {
		await createUser(created, 'SH002');
		expect(serviceFetch).toHaveBeenLastCalledWith(
			'/api/v1/users?shelter_code=SH002',
			expect.objectContaining({ method: 'POST', body: JSON.stringify(created) })
		);
		await updateUser('staff01', { display_name: 'T' }, 'SH002');
		expect(serviceFetch).toHaveBeenLastCalledWith(
			'/api/v1/users?shelter_code=SH002',
			expect.objectContaining({
				method: 'PUT',
				body: JSON.stringify({ name: 'staff01', display_name: 'T' })
			})
		);
	});

	it('deletes with the name and ?shelter_code=', async () => {
		await deleteUser('staff 01', 'SH002');
		expect(serviceFetch).toHaveBeenCalledWith('/api/v1/users?name=staff+01&shelter_code=SH002', {
			method: 'DELETE'
		});
	});

	it('sends no shelter_code for a system admin, who names none', async () => {
		await listUsers();
		expect(serviceFetch).toHaveBeenLastCalledWith('/api/v1/users');
		await listUsers(null);
		expect(serviceFetch).toHaveBeenLastCalledWith('/api/v1/users');
		await deleteUser('a');
		expect(serviceFetch).toHaveBeenLastCalledWith('/api/v1/users?name=a', { method: 'DELETE' });
	});
});
