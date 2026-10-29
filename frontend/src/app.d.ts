// See https://svelte.dev/docs/kit/types#app.d.ts

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** Per-person failures of a create batch, passed to the batch page via `goto` state. */
			failed?: { evacuee_id: string; error: string }[];
		}
		// interface Platform {}
	}
	interface Window {
		grecaptcha?: {
			render?: (
				container: HTMLElement | string,
				parameters: { sitekey: string; callback?: string | ((...args: unknown[]) => void) }
			) => void;
			execute?: (sitekey: string, options: { action: string }) => Promise<string>;
			enterprise?: {
				ready: (callback: () => void | Promise<void>) => void;
				execute: (sitekey: string, options: { action: string }) => Promise<string>;
			};
		};
		__captchaToken?: string;
	}
}

export {};
