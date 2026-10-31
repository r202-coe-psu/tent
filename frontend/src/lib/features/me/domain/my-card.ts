export type MyCardNoneReason = 'no_token' | 'volunteer_unlinked' | 'inactive' | 'server_admin';

export type MyCard =
	| {
			kind: 'staff';
			payload: string;
			display_name: string;
			position: string | null;
			roles: string[];
	  }
	| {
			kind: 'volunteer';
			payload: string;
			display_name: string;
			volunteer_code: string | null;
			roles: string[];
	  }
	| { kind: 'none'; reason: MyCardNoneReason };
