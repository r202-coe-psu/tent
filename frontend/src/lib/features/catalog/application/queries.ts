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
import { getShelterDb } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import type { PaginatedResult } from '$lib/db/repository';
import { catalogRepository, CATALOG_DB } from '../data/catalog.remote';
import { authStore } from '$lib/stores/auth.svelte';
import {
	isSystemAdmin,
	isShelterManager,
	isWarehouseStaff,
	shelterCodeFromRoles
} from '$lib/auth/roles';
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
	itemcategories: (shelterCode?: string | null) =>
		[...catalogKeys.all, 'itemcategories', shelterCode ?? null] as const,
	itemcategoriesPaginated: (page: number, pageSize: number, shelterCode?: string | null) =>
		[
			...catalogKeys.all,
			'itemcategories',
			{ page, pageSize, shelterCode: shelterCode ?? null }
		] as const,
	itemmasters: (shelterCode?: string | null) =>
		[...catalogKeys.all, 'itemmasters', shelterCode ?? null] as const,
	itemmastersPaginated: (page: number, pageSize: number, shelterCode?: string | null) =>
		[
			...catalogKeys.all,
			'itemmasters',
			{ page, pageSize, shelterCode: shelterCode ?? null }
		] as const,
	recipes: (shelterCode?: string | null) =>
		[...catalogKeys.all, 'recipes', shelterCode ?? null] as const,
	recipesPaginated: (page: number, pageSize: number, shelterCode?: string | null) =>
		[...catalogKeys.all, 'recipes', { page, pageSize, shelterCode: shelterCode ?? null }] as const
};

// Item Categories
export const useItemCategories = (shelterCodeGetter: () => string | null = () => null) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemcategories(shelterCodeGetter()),
		queryFn: () => catalogRepository().listItemCategories(shelterCodeGetter())
	}));

export const useItemCategoriesPaginated = (
	page: () => number,
	pageSize: () => number,
	shelterCodeGetter: () => string | null = () => null
) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemcategoriesPaginated(page(), pageSize(), shelterCodeGetter()),
		queryFn: () =>
			catalogRepository().listItemCategoriesPaginated(
				page(),
				pageSize(),
				shelterCodeGetter()
			) as Promise<PaginatedResult<ItemCategory>>
	}));

export const useItemCategory = (
	id: () => string,
	shelterCodeGetter: () => string | null = () => null
) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemcategory', id(), shelterCodeGetter()],
		queryFn: () => catalogRepository().getItemCategory(id(), shelterCodeGetter()),
		enabled: !!id()
	}));

function enforceWriteAccess(shelterCode?: string | null) {
	const roles = authStore.user?.roles ?? [];
	if (isSystemAdmin(roles)) return;

	if (shelterCode) {
		const isManager = isShelterManager(roles);
		const isWS = isWarehouseStaff(roles);
		const userShelterCode = shelterCodeFromRoles(roles);
		if ((isManager || isWS) && userShelterCode === shelterCode) {
			return;
		}
	}

	throw new Error('Unauthorized: You do not have permission to write to this catalog.');
}

export const useCreateItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			input,
			ctx,
			shelterCode
		}: {
			input: ItemCategoryInput;
			ctx: AuthorContext;
			shelterCode?: string;
		}) => {
			enforceWriteAccess(shelterCode);
			return catalogRepository().createItemCategory(input, ctx, shelterCode);
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
			enforceWriteAccess(itemCategory.shelter_code);
			return catalogRepository().updateItemCategory(itemCategory);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Item Masters
export const useItemMasters = (shelterCodeGetter: () => string | null = () => null) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmasters(shelterCodeGetter()),
		queryFn: () => catalogRepository().listItemMasters(shelterCodeGetter())
	}));

export const useItemMastersPaginated = (
	page: () => number,
	pageSize: () => number,
	shelterCodeGetter: () => string | null = () => null
) =>
	createQuery(() => ({
		queryKey: catalogKeys.itemmastersPaginated(page(), pageSize(), shelterCodeGetter()),
		queryFn: () =>
			catalogRepository().listItemMastersPaginated(
				page(),
				pageSize(),
				shelterCodeGetter()
			) as Promise<PaginatedResult<ItemMaster>>
	}));

export const useItemMaster = (
	id: () => string,
	shelterCodeGetter: () => string | null = () => null
) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'itemmaster', id(), shelterCodeGetter()],
		queryFn: () => catalogRepository().getItemMaster(id(), shelterCodeGetter()),
		enabled: !!id()
	}));

export const useCreateItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			input,
			ctx,
			shelterCode
		}: {
			input: ItemMasterInput;
			ctx: AuthorContext;
			shelterCode?: string;
		}) => {
			enforceWriteAccess(shelterCode);
			return catalogRepository().createItemMaster(input, ctx, shelterCode);
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
			enforceWriteAccess(itemMaster.shelter_code);
			return catalogRepository().updateItemMaster(itemMaster);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

// Recipes
export const useRecipes = (shelterCodeGetter: () => string | null = () => null) =>
	createQuery(() => ({
		queryKey: catalogKeys.recipes(shelterCodeGetter()),
		queryFn: () => catalogRepository().listRecipes(shelterCodeGetter())
	}));

export const useRecipesPaginated = (
	page: () => number,
	pageSize: () => number,
	shelterCodeGetter: () => string | null = () => null
) =>
	createQuery(() => ({
		queryKey: catalogKeys.recipesPaginated(page(), pageSize(), shelterCodeGetter()),
		queryFn: () =>
			catalogRepository().listRecipesPaginated(page(), pageSize(), shelterCodeGetter()) as Promise<
				PaginatedResult<Recipe>
			>
	}));

export const useRecipe = (id: () => string, shelterCodeGetter: () => string | null = () => null) =>
	createQuery(() => ({
		queryKey: [...catalogKeys.all, 'recipe', id(), shelterCodeGetter()],
		queryFn: () => catalogRepository().getRecipe(id(), shelterCodeGetter()),
		enabled: !!id()
	}));

export const useCreateRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: ({
			input,
			ctx,
			shelterCode
		}: {
			input: RecipeInput;
			ctx: AuthorContext;
			shelterCode?: string;
		}) => {
			enforceWriteAccess(shelterCode);
			return catalogRepository().createRecipe(input, ctx, shelterCode);
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
			enforceWriteAccess(recipe.shelter_code);
			return catalogRepository().updateRecipe(recipe);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useDeleteItemMaster = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string | null }) => {
			const item = await catalogRepository().getItemMaster(id, shelterCode);
			if (!item) throw new Error('Item not found');
			enforceWriteAccess(item.shelter_code);
			return catalogRepository().deleteItemMaster(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useDeleteItemCategory = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string | null }) => {
			const category = await catalogRepository().getItemCategory(id, shelterCode);
			if (!category) throw new Error('Category not found');
			enforceWriteAccess(category.shelter_code);
			return catalogRepository().deleteItemCategory(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export const useDeleteRecipe = () => {
	const queryClient = useQueryClient();
	return createMutation(() => ({
		mutationFn: async ({ id, shelterCode }: { id: string; shelterCode?: string | null }) => {
			const recipe = await catalogRepository().getRecipe(id, shelterCode);
			if (!recipe) throw new Error('Recipe not found');
			enforceWriteAccess(recipe.shelter_code);
			return catalogRepository().deleteRecipe(id, shelterCode);
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: catalogKeys.all });
		}
	}));
};

export function startCatalogMasterLiveQuery(queryClient: QueryClient): SubscribeDataChangesHandle {
	const allowed = ['item_category', 'item_master', 'recipe', 'sop_profile'];
	const catalogHandle = subscribeDataChanges(queryClient, CATALOG_DB, (type) => {
		if (allowed.includes(type)) {
			return [catalogKeys.all];
		}
		return [];
	});
	const shelterHandle = subscribeDataChanges(queryClient, getShelterDb, (type) => {
		if (allowed.includes(type)) {
			return [catalogKeys.all];
		}
		return [];
	});
	return {
		stop: () => {
			catalogHandle.stop();
			shelterHandle.stop();
		}
	};
}
