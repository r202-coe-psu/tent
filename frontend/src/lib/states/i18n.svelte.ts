let initialLang = 'th';
if (typeof localStorage !== 'undefined') {
	const saved = localStorage.getItem('app-lang');
	if (saved === 'th' || saved === 'en') {
		initialLang = saved;
	}
}

const state = $state({ current: initialLang });

export const langState = {
	get current() {
		return state.current;
	},
	set current(val: string) {
		state.current = val;
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('app-lang', val);
		}
	}
};
