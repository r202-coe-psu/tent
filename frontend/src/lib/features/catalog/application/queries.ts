import {
	createMutation,
	createQuery,
	useQueryClient,
	type QueryClient
} from '@tanstack/svelte-query';
import { startLiveQuery, type LiveQueryHandle } from '$lib/db/live-query';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { CatalogRepository, shelterDb } from '../data/catalog.pouch';
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
		queryFn: () => CatalogRepository().listItemCategories()
	}));

export const useItemCategoriesPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemcategoriesPaginated(page(), pageSize()),
		queryFn: () =>
			CatalogRepository().listItemCategoriesPaginated(page(), pageSize()) as Promise<
				PaginatedResult<ItemCategory>
			>
	}));

export const useItemCategory = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemcategory', id()],
		queryFn: () => CatalogRepository().getItemCategory(id()),
		enabled: !!id()
	}));

export const useCreateItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ItemCategoryInput; ctx: AuthorContext }) =>
			CatalogRepository().createItemCategory(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (itemCategory: ItemCategory) =>
			CatalogRepository().updateItemCategory(itemCategory),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Item Masters
export const useItemMasters = () =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmasters(),
		queryFn: () => CatalogRepository().listItemMasters()
	}));

export const useItemMastersPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmastersPaginated(page(), pageSize()),
		queryFn: () =>
			CatalogRepository().listItemMastersPaginated(page(), pageSize()) as Promise<
				PaginatedResult<ItemMaster>
			>
	}));

export const useItemMaster = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemmaster', id()],
		queryFn: () => CatalogRepository().getItemMaster(id()),
		enabled: !!id()
	}));

export const useCreateItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: ItemMasterInput; ctx: AuthorContext }) =>
			CatalogRepository().createItemMaster(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (itemMaster: ItemMaster) => CatalogRepository().updateItemMaster(itemMaster),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Recipes
export const useRecipes = () =>
	createQuery(() => ({
		queryKey: catalogKeys.recipes(),
		queryFn: () => CatalogRepository().listRecipes()
	}));

export const useRecipesPaginated = (page: () => number, pageSize: () => number) =>
	createQuery(() => ({
		queryKey: catalogKeys.recipesPaginated(page(), pageSize()),
		queryFn: () =>
			CatalogRepository().listRecipesPaginated(page(), pageSize()) as Promise<
				PaginatedResult<Recipe>
			>
	}));

export const useRecipe = (id: () => string) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'recipe', id()],
		queryFn: () => CatalogRepository().getRecipe(id()),
		enabled: !!id()
	}));

export const useCreateRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({ input, ctx }: { input: RecipeInput; ctx: AuthorContext }) =>
			CatalogRepository().createRecipe(input, ctx),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useUpdateRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: (recipe: Recipe) => CatalogRepository().updateRecipe(recipe),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export function startCatalogLiveQuery(queryClient: QueryClient): LiveQueryHandle {
	return startLiveQuery(shelterDb(), queryClient, (type) => {
		if (type === 'item_category') {
			return [catalogKeys.itemcategories(), [...catalogKeys.all, 'itemcategories']];
		}
		if (type === 'item_master') {
			return [catalogKeys.itemmasters(), [...catalogKeys.all, 'itemmasters']];
		}
		if (type === 'recipe') {
			return [catalogKeys.recipes(), [...catalogKeys.all, 'recipes']];
		}
		return [];
	});
}
