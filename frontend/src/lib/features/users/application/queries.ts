import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createUser, deleteUser, listUsers, updateUser } from '../data/users.api';
import type { DutyWindow } from '../domain/schema';

export const usersKeys = {
	all: ['users'] as const,
	list: () => [...usersKeys.all, 'list'] as const
};

export const useUsers = () =>
	createQuery(() => ({
		queryKey: usersKeys.list(),
		queryFn: listUsers
	}));

export const useCreateUser = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (input: {
			name: string;
			password: string;
			display_name: string;
			roles: string[];
			affiliation_tags?: string[];
			volunteer_id?: string | null;
			duty_window?: DutyWindow | null;
			active?: boolean;
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
			affiliation_tags?: string[];
			volunteer_id?: string | null;
			duty_window?: DutyWindow | null;
			active?: boolean;
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
