# E-Nay local data

The application creates maternal_records.txt, child_records.txt, system_data.dat,
and .enay.lock here when needed. First launch starts with no patient records.
Patient data, process locks, staging files, and backups are excluded from Git.
Do not commit real patient records. Tests use fictional records in temporary folders.
