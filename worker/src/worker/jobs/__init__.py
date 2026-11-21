"""Merged misc jobs run by the ``jobs-worker`` container (issue #1479)."""

from __future__ import annotations

from worker.jobs.base import Job
from worker.jobs.edge_users_copy import EdgeUsersCopyJob
from worker.jobs.import_shelter import ImportShelterJob
from worker.jobs.printing import PrintingJob
from worker.jobs.shelter_close import ShelterCloseJob

# Run order inside one tick: printing -> edge-users-copy -> import-shelter -> shelter-close.
JOBS: list[Job] = [
    PrintingJob(),
    EdgeUsersCopyJob(),
    ImportShelterJob(),
    ShelterCloseJob(),
]
