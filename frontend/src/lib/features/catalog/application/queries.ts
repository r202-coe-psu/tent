import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import {
	subscribeDataChanges,
	type SubscribeDataChangesHandle
} from '$lib/db/subscribe-data-changes';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { catalogRepository, CATALOG_DB } from '../data/catalog.remote';
import { authStore } from '$lib/stores/auth.svelte';
import { isSystemAdmin } from '$lib/auth/roles';
import type {
	ItemCategory,
	ItemCategoryInput,
	ItemMaster,
	ItemMasterInput,
	Recipe,
	RecipeInput
} from '../domain/catalog';

export const catalogKeys = {
	all: ['catalog'] as const,
	itemcategories: () => [...catalogKeys.all, 'itemcategories'] as const,
	itemcategoriesPaginated: (page: number, pageSize: number) =>
		[...catalogKeys.all, 'itemcategories', { page, pageSize }] as const,
	itemmasters: () => [...catalogKeys.all, 'itemmasters'] as const,
	itemmastersPaginated: (page: number, pageSize: number) =>
		[...catalogKeys.all, 'itemmasters', { page, pageSize }] as const,
	recipes: () => [...catalogKeys.all, 'recipes'] as const,
	recipesPaginated: (page: number, pageSize: number) =>
		[...catalogKeys.all, 'recipes', { page, pageSize }] as const
};

// Item Categories
export const useItemCategories = () =>
	createQuery(() => ({
		queryKey: catalogKeys.itemcategories(),
		queryFn: () => catalogRepository().listItemCategories()
	}));

export const useItemCategoriesPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemcategoriesPaginated(page(), pageSize()),
		queryFn: () =>
			catalogRepository().listItemCategoriesPaginated(page(), pageSize()) as Promise<
				PaginatedResult<ItemCategory>
			>
	}));

export const useItemCategory = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemcategory', id()],
		queryFn: () => catalogRepository().getItemCategory(id()),
		enabled: !!id()
	}));

function enforceSA() {
	if (!isSystemAdmin(authStore.user?.roles ?? [])) {
		throw new Error('Unauthorized: Only System Admins can write to the catalog.');
	}
}

export const useCreateItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ItemCategoryInput; ctx: AuthorContext }) => {
			enforceSA();
			return catalogRepository().createItemCategory(input, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (itemCategory: ItemCategory) => {
			enforceSA();
			return catalogRepository().updateItemCategory(itemCategory);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Item Masters
export const useItemMasters = () =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmasters(),
		queryFn: () => catalogRepository().listItemMasters()
	}));

export const useItemMastersPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmastersPaginated(page(), pageSize()),
		queryFn: () =>
			catalogRepository().listItemMastersPaginated(page(), pageSize()) as Promise<
				PaginatedResult<ItemMaster>
			>
	}));

export const useItemMaster = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemmaster', id()],
		queryFn: () => catalogRepository().getItemMaster(id()),
		enabled: !!id()
	}));

export const useCreateItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ItemMasterInput; ctx: AuthorContext }) => {
			enforceSA();
			return catalogRepository().createItemMaster(input, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (itemMaster: ItemMaster) => {
			enforceSA();
			return catalogRepository().updateItemMaster(itemMaster);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Recipes
export const useRecipes = () =>
	createQuery(() => ({
		queryKey: catalogKeys.recipes(),
		queryFn: () => catalogRepository().listRecipes()
	}));

export const useRecipesPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.recipesPaginated(page(), pageSize()),
		queryFn: () =>
			catalogRepository().listRecipesPaginated(page(), pageSize()) as Promise<
				PaginatedResult<Recipe>
			>
	}));

export const useRecipe = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'recipe', id()],
		queryFn: () => catalogRepository().getRecipe(id()),
		enabled: !!id()
	}));

export const useCreateRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: RecipeInput; ctx: AuthorContext }) => {
			enforceSA();
			return catalogRepository().createRecipe(input, ctx);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (recipe: Recipe) => {
			enforceSA();
			return catalogRepository().updateRecipe(recipe);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export function startCatalogMasterLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	return subscribeDataChanges(queryClient, CATALOG_DB, (type) => {
		const allowed = ['item_category', 'item_master', 'recipe', 'sop_profile'];
		if (allowed.includes(type)) {
			return [catalogKeys.all];
		}
		return [];
	});
}
