import { goto } from '$app/navigation';
import { resolve } from '$app/paths';

export function navigateToKioskHome(contextQuery: string): void {
	void goto(resolve(`/kiosk${contextQuery as `?${string}`}`));
}
