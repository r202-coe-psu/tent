import { goto } from '$app/navigation';
import { resolve } from '$app/paths';
import type { KioskContextQuery } from '../domain/display-context';

export function navigateToKioskHome(contextQuery: KioskContextQuery): void {
	void goto(resolve(`/kiosk${contextQuery}`));
}
