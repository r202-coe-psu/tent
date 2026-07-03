// See https://svelte.dev/docs/kit/types#app.d.ts

// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
	interface Window {
		grecaptcha?: {
			render: (
				container: HTMLElement | string,
				parameters: { sitekey: string; callback?: string | ((...args: unknown[]) => void) }
			) => void;
			execute: (sitekey: string, options: { action: string }) => Promise<string>;
		};
		__captchaToken?: string;
	}
}

export {};
