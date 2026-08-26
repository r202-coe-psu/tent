import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import {
	listAnnouncements,
	getAnnouncement,
	createAnnouncement as createAnnouncementApi,
	updateAnnouncement as updateAnnouncementApi,
	deleteAnnouncement as deleteAnnouncementApi
} from '../data/announcement.api';
import type { Announcement } from '../domain/announcement';

export const announcementKeys = {
	all: ['announcements'] as const,
	lists: () => [...announcementKeys.all, 'list'] as const,
	detail: (id: string) => [...announcementKeys.all, 'detail', id] as const
};

export function useAnnouncements() {
	return createQuery(() => ({
		queryKey: announcementKeys.lists(),
		queryFn: () => listAnnouncements()
	}));
}

export function useAnnouncement(id: string) {
	return createQuery(() => ({
		queryKey: announcementKeys.detail(id),
		queryFn: () => getAnnouncement(id),
		enabled: !!id
	}));
}

export function useCreateAnnouncement() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (
			data: Pick<
				Announcement,
				'title' | 'description' | 'title_en' | 'description_en' | 'severity' | 'is_active'
			>
		) => createAnnouncementApi(data),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: announcementKeys.lists() });
		}
	}));
}

export function useUpdateAnnouncement() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			id,
			data
		}: {
			id: string;
			data: Partial<
				Pick<
					Announcement,
					'title' | 'description' | 'title_en' | 'description_en' | 'severity' | 'is_active'
				>
			>;
		}) => updateAnnouncementApi(id, data),
		onSuccess: (_res, variables) => {
			queryClient.invalidateQueries({ queryKey: announcementKeys.detail(variables.id) });
			queryClient.invalidateQueries({ queryKey: announcementKeys.lists() });
		}
	}));
}

export function useDeleteAnnouncement() {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (id: string) => deleteAnnouncementApi(id),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: announcementKeys.lists() });
		}
	}));
}
