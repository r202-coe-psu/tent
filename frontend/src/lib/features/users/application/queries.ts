import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createUser, deleteUser, listUsers, updateUser } from '../data/users.api';
import { listShelterStaff } from '../data/staff-directory.api';

export const usersKeys = {
	all: ['users'] as const,
	list: () => [...usersKeys.all, 'list'] as const
};

export const shelterStaffDirectoryKeys = {
	list: (shelterCode: string) => ['shelter-staff-directory', shelterCode] as const
};

/** `enabled` lets callers skip the request (`GET /api/v1/users` is SA/SM only → 403 otherwise). */
export const useUsers = (enabled: () => boolean = () => true) =>
	createQuery(() => ({
		queryKey: usersKeys.list(),
		queryFn: listUsers,
		enabled: enabled()
	}));

export const useShelterStaffDirectory = (shelterCode: () => string | null | undefined) =>
	createQuery(() => {
		const code = shelterCode();
		return {
			queryKey: shelterStaffDirectoryKeys.list(code ?? ''),
			queryFn: () => listShelterStaff(code ?? ''),
			enabled: Boolean(code),
			staleTime: 5 * 60_000
		};
	});

export const useCreateUser = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: {
			name: string;
			password: string;
			display_name: string;
			roles: string[];
			personnel_type?: 'staff' | 'volunteer';
			organization?: string | null;
			position?: string | null;
			phone?: string | null;
			email?: string | null;
			notes?: string | null;
			volunteer_id?: string | null;
			duty_window?: {
				start_ts: string;
				end_ts: string;
			} | null;
			must_change_password?: boolean;
			affiliation_tags?: string[];
		}) => createUser(input),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all })
	}));
};

export const useUpdateUser = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: {
			name: string;
			password?: string;
			display_name?: string;
			roles?: string[];
			personnel_type?: 'staff' | 'volunteer';
			organization?: string | null;
			position?: string | null;
			phone?: string | null;
			email?: string | null;
			notes?: string | null;
			volunteer_id?: string | null;
			duty_window?: {
				start_ts: string;
				end_ts: string;
			} | null;
			active?: boolean;
			must_change_password?: boolean;
			affiliation_tags?: string[];
		}) => {
			const { name, ...rest } = input;
			return updateUser(name, rest);
		},
		onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all })
	}));
};

export const useDeleteUser = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (name: string) => deleteUser(name),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all })
	}));
};
