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
				parameters: { sitekey: string; callback?: string | Function }
			) => void;
		};
		__captchaToken?: string;
	}
}

export {};
