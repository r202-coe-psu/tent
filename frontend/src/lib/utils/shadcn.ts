import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/**
 * Shared keyboard / highlight affordance for list options.
 * Use on Select, SearchSelect, Command (Combobox), and DropdownMenu items
 * so Tab / arrow highlight looks the same everywhere.
 */
export const listOptionActiveClass =
	'focus:bg-accent focus:text-accent-foreground focus:ring-2 focus:ring-ring focus:ring-offset-1 focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:ring-2 data-highlighted:ring-ring data-highlighted:ring-offset-1 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground data-[selected=true]:ring-2 data-[selected=true]:ring-ring data-[selected=true]:ring-offset-1';

export const listOptionHoverClass = 'hover:bg-accent hover:text-accent-foreground';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChild<T> = T extends { child?: any } ? Omit<T, 'child'> : T;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WithoutChildren<T> = T extends { children?: any } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & { ref?: U | null };
