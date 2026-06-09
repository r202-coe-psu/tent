import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
import { createUser, deleteUser, listUsers } from '../data/users.api';

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
		mutationFn: ({ name, password }: { name: string; password: string }) =>
			createUser(name, password),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all })
	}));
};

export const useDeleteUser = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ id, rev }: { id: string; rev: string }) => deleteUser(id, rev),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: usersKeys.all })
	}));
};
