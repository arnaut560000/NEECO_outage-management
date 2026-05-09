# NEECO Deployment Checklist

## Before Go-Live

- [ ] Create and activate the deployment virtual environment
- [ ] Install Python dependencies with `pip install -r requirements.txt`
- [ ] Verify core packages import successfully with `python -c "import click, flask, openpyxl, waitress"`
- [ ] Install Python and project dependencies
- [ ] Set `OUTAGE_ENV=production`
- [ ] Set a strong `OUTAGE_SECRET_KEY`
- [ ] Set `OUTAGE_DB_PATH` to a persistent server path
- [ ] Set `OUTAGE_BACKUP_DIR` to a persistent backup path
- [ ] Set `OUTAGE_WORKSPACE_CACHE_DIR` to a persistent server path
- [ ] Set `OUTAGE_AUTO_SEED_ADMIN=0`
- [ ] Set `OUTAGE_SHOW_SEED_CREDENTIALS=0`
- [ ] Set `OUTAGE_SESSION_COOKIE_SECURE=1`
- [ ] Set `OUTAGE_USE_PROXY_FIX=1` when running behind IIS or another reverse proxy that forwards HTTPS headers
- [ ] Set `OUTAGE_DEBUG=0`
- [ ] Confirm source identifiers and source coordinates for the deployed feeder environment
- [ ] Confirm production startup rejects unsafe settings such as debug mode, auto-seeding, visible seed credentials, insecure cookies, or a short/default secret key

## Bootstrap

- [ ] Start the app once with `python -m waitress --listen=0.0.0.0:8080 wsgi:app`
- [ ] Open the login page and confirm it loads without a startup error
- [ ] Create the first admin with:

```powershell
flask --app wsgi.py seed-admin --username admin --password "Use-A-Strong-Password"
```

- [ ] Log in as admin
- [ ] Verify `Manage Users`, `Audit Logs`, and `System Status`
- [ ] Create supervisor/operator/viewer accounts as needed

## Data Safety

- [ ] Run one manual backup with:

```powershell
flask --app wsgi.py backup-db
```

- [ ] Verify the backup file appears in the configured backup directory
- [ ] Confirm the team understands that `backup-db` backs up SQLite only, not the live workspace cache folder
- [ ] If live uploaded workspace restore must survive server loss, include `OUTAGE_WORKSPACE_CACHE_DIR` in the backup plan
- [ ] Configure scheduled backups in Windows Task Scheduler
- [ ] Confirm restore instructions are stored with the department handoff documents
- [ ] Perform one real restore drill on a test copy before go-live

## Workflow Validation

- [ ] Upload a real GPX file
- [ ] Upload a real XLSX mapping file
- [ ] Upload a real KML overlay
- [ ] Return to the main page and confirm the user workspace restores correctly
- [ ] Clear Current Workspace and confirm saved interruptions remain in Records / History
- [ ] Open the validation report
- [ ] Save an interruption
- [ ] Confirm it appears in `Records / History`
- [ ] Export an interruption workbook
- [ ] Verify audit logs record the actions

## Restore Verification

- [ ] Stop the service once on a test machine or test path
- [ ] Restore a backup SQLite file to the active database path
- [ ] Start the service again
- [ ] Verify login works
- [ ] Verify Records / History still loads
- [ ] Verify Audit Logs still loads
- [ ] If workspace cache was restored too, verify one user workspace restores
- [ ] If workspace cache was not restored, verify the app shows a recovery notice and saved interruptions still remain available

## Security Checks

- [ ] Confirm login page does not expose seeded credentials in production
- [ ] Confirm CSRF-protected actions work:
  - login
  - logout
  - uploads
  - save/delete interruption
  - clear workspace
  - exports
  - admin user actions
- [ ] Confirm secure cookies are enabled behind HTTPS
- [ ] Confirm seeded credentials are still hidden even if an operator opens the login page after restart
- [ ] Confirm IIS/reverse proxy forwards `X-Forwarded-Proto` and `X-Forwarded-Host` correctly if `OUTAGE_USE_PROXY_FIX=1`
- [ ] Start the production service with `python -m waitress --listen=0.0.0.0:8080 wsgi:app`

## Handoff

- [ ] Share admin bootstrap procedure with the department lead
- [ ] Share backup and restore procedure
- [ ] Share troubleshooting notes for database busy, unreadable GPX/XLSX/KML, workspace restore issues, and export blocked by validation errors
- [ ] Share supported upload expectations for GPX, XLSX, and KML
- [ ] Record the deployment path, database path, and backup path
