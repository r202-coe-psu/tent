export const SHELTER_DASHBOARD_VIEWS = {
	_id: '_design/app',
	views: {
		occupancy: {
			map: `function (doc) {
				if (doc.type !== 'evacuee' || !doc.current_stay) return;
				emit(doc.current_stay.status, 1);
			}`,
			reduce: '_count'
		},
		demographics_by_age: {
			map: `function (doc) {
				if (doc.type !== 'evacuee') return;

				if (!doc.birth_year) {
					emit('unknown', 1);
					return;
				}

				var ceYear = doc.birth_year - 543;
				var currentYear = new Date().getFullYear();
				var age = currentYear - ceYear;
				var bucket;

				if (age <= 4) {
					bucket = '0-4';
				} else if (age <= 11) {
					bucket = '5-11';
				} else if (age <= 17) {
					bucket = '12-17';
				} else if (age <= 59) {
					bucket = '18-59';
				} else {
					bucket = '60+';
				}

				emit(bucket, 1);
			}`,
			reduce: '_count'
		},
		demographics_by_country: {
			map: `function (doc) {
				if (doc.type !== 'evacuee') return;
				var c = (doc.country || '').trim().toUpperCase() || 'UNKNOWN';
				emit(c, 1);
			}`,
			reduce: '_count'
		},
		registrations_by_date: {
			map: `function (doc) {
				if (doc.type !== 'evacuee' || !doc.created_at) return;
				var date = doc.created_at.slice(0, 10);
				emit(date, 1);
			}`,
			reduce: '_count'
		}
	}
};
