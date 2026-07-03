# Outage Management System

Flask-based outage tracing, interruption management, workspace restore, validation, audit logging, and XLSX export for feeder outage operations.

This project is intended for department deployment with SQLite, role-based access, saved interruptions, upload validation, audit logs, and operator-facing trace confidence warnings.

## What This System Does

- Upload and trace feeder GPX data
- Upload XLSX consumer/account mapping
- Upload KML overlays and transformer/line features
- Save and reopen interruptions
- Persist a live workspace per logged-in user
- Export outage workbooks and disconnected fragment workbooks
- Show validation summaries, inferred-path warnings, and audit trails
- Support role-based access for `admin`, `supervisor`, `operator`, and `viewer`

## Local Setup

If you downloaded this project as a GitHub ZIP on Windows, the quickest start is:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\run_local.ps1
```

Then open `http://127.0.0.1:5000` and sign in with the development admin account shown in the terminal.

Manual setup:

1. Create and activate a virtual environment.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

2. Install dependencies.

```powershell
pip install -r requirements.txt
```

3. Set local development environment variables.

```powershell
$env:OUTAGE_ENV="development"
$env:OUTAGE_SECRET_KEY="replace-this-with-a-local-dev-secret-key"
$env:OUTAGE_AUTO_SEED_ADMIN="1"
$env:OUTAGE_SHOW_SEED_CREDENTIALS="1"
$env:OUTAGE_DEBUG="1"
```

4. Run the local development server.

```powershell
python app.py
```

5. Open the browser at `http://127.0.0.1:5000`.

The local SQLite database, backups, and workspace cache are created automatically when the app starts. They are intentionally not included in the GitHub repository.

## Running Tests

Run the automated regression suite from the project folder:

```powershell
python -m unittest discover -s tests -v
```

What the current tests cover:

- login with CSRF protection
- permission checks for audit logs and saved-record deletion
- workspace metadata self-repair when cache files are missing
- interruption create/list/export/delete flow
- transformer detection rule helpers

## Production Deployment For Windows Office/Server Use

This app should not be deployed in production with `python app.py`.

## Auto-Start Server PC Setup

Use this when one Windows computer will act as the department server and should start the system automatically when the PC turns on, even before anyone logs in.

Recommended folder:

```text
C:\NEECO\outage_management
```

From an elevated PowerShell window on the server PC:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\install_startup_task.ps1
```

The installer will:

- create `.venv` if needed
- install Python dependencies
- create local `data`, `logs`, and `server.env`
- register a Windows Scheduled Task named `NEECO Outage Management Server`
- run the task as `SYSTEM` at computer startup, before user login
- start Waitress on `0.0.0.0:8080`

After installation, open the system on the server PC:

```text
http://127.0.0.1:8080
```

Other computers on the same network should open:

```text
http://SERVER-PC-IP:8080
```

The task uses `run_server.ps1`. Local server settings live in `server.env`, which is intentionally ignored by Git. Logs are written to `logs\server.out.log` and `logs\server.err.log`.

To remove the auto-start task later, run PowerShell as administrator:

```powershell
.\uninstall_startup_task.ps1
```

Notes:

- Keep the server project in a stable local folder. Avoid OneDrive/Desktop for the real server because boot-time tasks can run before OneDrive is ready.
- If Windows Firewall blocks other computers, allow inbound TCP traffic on port `8080`.
- The default auto-start setup is intended for internal LAN HTTP use. For HTTPS/IIS deployment, use the stricter production settings below.

Preferred Windows deployment pattern:

1. Prepare a service account or locked-down department Windows user.
2. Place the project in a stable folder, for example:

```text
C:\NEECO\outage_management
```

3. Create a persistent data folder for the SQLite database and backups, for example:

```text
C:\NEECO\data
C:\NEECO\backups
```

4. Create and activate a virtual environment on the server, then install dependencies.

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -c "import click, flask, openpyxl, waitress"
```

5. Set environment variables for production.

```powershell
$env:OUTAGE_ENV="production"
$env:OUTAGE_SECRET_KEY="use-a-long-random-secret-key-at-least-32-characters"
$env:OUTAGE_DB_PATH="C:\NEECO\data\outage_management.sqlite3"
$env:OUTAGE_BACKUP_DIR="C:\NEECO\backups"
$env:OUTAGE_WORKSPACE_CACHE_DIR="C:\NEECO\data\workspace_cache"
$env:OUTAGE_AUTO_SEED_ADMIN="0"
$env:OUTAGE_SHOW_SEED_CREDENTIALS="0"
$env:OUTAGE_SESSION_COOKIE_SECURE="1"
$env:OUTAGE_USE_PROXY_FIX="1"
$env:OUTAGE_DEBUG="0"
```

6. Run behind Waitress on the server.

```powershell
python -m waitress --listen=0.0.0.0:8080 wsgi:app
```

7. Open the login page once and confirm the app starts cleanly before handing it to users.

8. Put the service behind HTTPS using IIS, a reverse proxy, or another internal web gateway.
   If the proxy forwards `X-Forwarded-Proto` / `X-Forwarded-Host`, keep `OUTAGE_USE_PROXY_FIX=1` so Flask sees the correct HTTPS request context.

9. Schedule regular backups with Windows Task Scheduler using the backup CLI:

```powershell
flask --app wsgi.py backup-db
```

## Safe Admin Bootstrap

Production-safe bootstrap method:

1. Keep automatic seeding disabled.
2. Set the production secret key.
3. Create the admin explicitly:

```powershell
flask --app wsgi.py seed-admin --username admin --password "Use-A-Strong-Password"
```

4. Log in and change the password if it was temporary.

Notes:

- Seeded credentials are never shown in production mode.
- Automatic seeding is off by default in production mode.
- Production startup now fails fast if any of these are unsafe:
  - missing or short `OUTAGE_SECRET_KEY`
  - the built-in development fallback secret is still being used
  - `OUTAGE_DEBUG=1`
  - `OUTAGE_AUTO_SEED_ADMIN=1`
  - `OUTAGE_SHOW_SEED_CREDENTIALS=1`
  - `OUTAGE_SESSION_COOKIE_SECURE=0`

## Environment Variables

| Variable | Purpose | Development Default | Production Expectation |
| --- | --- | --- | --- |
| `OUTAGE_ENV` | Environment mode (`development`, `production`) | `development` | `production` |
| `OUTAGE_SECRET_KEY` | Flask session signing key | Fallback only in development | Required, strong, at least 32 characters |
| `OUTAGE_SECRET_KEY_MIN_LENGTH` | Minimum production secret length | `32` | Keep `32` or higher |
| `OUTAGE_DB_PATH` | SQLite database file path | `users.db` in project folder | Persistent data path |
| `OUTAGE_BACKUP_DIR` | Backup output folder | `backups` in project folder | Persistent backup folder |
| `OUTAGE_AUTO_SEED_ADMIN` | Auto-create admin at startup | `1` | `0` |
| `OUTAGE_SHOW_SEED_CREDENTIALS` | Show seeded admin credentials on login page | `1` | `0` |
| `OUTAGE_SEED_ADMIN_USERNAME` | Seed admin username | `admin` | Optional |
| `OUTAGE_SEED_ADMIN_PASSWORD` | Seed admin password | `Admin@12345` | Optional, use CLI instead |
| `OUTAGE_SESSION_COOKIE_SECURE` | Secure cookie requirement | `0` | `1` under HTTPS |
| `OUTAGE_SESSION_COOKIE_NAME` | Session cookie name | `outage_session` | Optional |
| `OUTAGE_PREFERRED_URL_SCHEME` | Preferred external scheme for generated URLs | `http` | Usually `https` |
| `OUTAGE_USE_PROXY_FIX` | Trust `X-Forwarded-*` headers from IIS/reverse proxy | `0` | `1` when proxy is configured correctly |
| `OUTAGE_PROXY_FIX_X_FOR` | Trusted proxy count for client IP | `1` | Optional |
| `OUTAGE_PROXY_FIX_X_PROTO` | Trusted proxy count for scheme/HTTPS | `1` | Optional |
| `OUTAGE_PROXY_FIX_X_HOST` | Trusted proxy count for forwarded host | `1` | Optional |
| `OUTAGE_DEBUG` | Flask debug mode | `1` | `0` |
| `OUTAGE_MAX_UPLOAD_BYTES` | Global request upload cap | `31457280` | Optional |
| `OUTAGE_MAX_FEEDER_UPLOAD_BYTES` | GPX upload cap | `15728640` | Optional |
| `OUTAGE_MAX_XLSX_UPLOAD_BYTES` | XLSX upload cap | `20971520` | Optional |
| `OUTAGE_MAX_KML_UPLOAD_BYTES` | KML upload cap | `20971520` | Optional |
| `OUTAGE_SQLITE_BUSY_TIMEOUT_MS` | SQLite busy timeout | `10000` | Optional |
| `OUTAGE_WORKSPACE_CACHE_DIR` | Disk cache path for per-user workspace payloads | `workspace_cache` in project folder | Persistent data path |
| `OUTAGE_WORKSPACE_LAZY_RESTORE_BYTES` | Restore large workspaces manually instead of automatically | `1048576` | Optional |
| `OUTAGE_AUDIT_LOG_RETENTION_DAYS` | Keep recent audit logs by age | `90` | Optional |
| `OUTAGE_AUDIT_LOG_MAX_ROWS` | Keep recent audit logs by row count | `10000` | Optional |
| `OUTAGE_SOURCE_IDENTIFIERS` | Source/substation identifiers | `DCC7,DCC,TAL0001` | Optional |
| `OUTAGE_SOURCE_COORDINATES` | Source/substation coordinates | `15.59822,120.92152` | Optional |

## Backup And Restore

### Create a backup

```powershell
flask --app wsgi.py backup-db
```

This creates a timestamped SQLite backup in the configured backup directory.

Important:

- `backup-db` backs up the SQLite database only
- live uploaded workspace cache files are stored separately in `OUTAGE_WORKSPACE_CACHE_DIR`
- if you want saved live workspace restore state after a full server restore, copy the workspace cache folder too

### Restore guide

1. Stop the running outage management service.
2. Make a copy of the current database before changing anything.
3. Copy the chosen backup file over the active database path.
4. Do not copy `-wal` or `-shm` files from the live system over the restored database.
5. If you want live uploaded workspace restore state to survive the restore, restore the matching `OUTAGE_WORKSPACE_CACHE_DIR` contents too.
6. Start the service again.
7. Verify login, records/history, audit logs, and one saved interruption before handing the system back to operators.

## Operator Workflow

1. Log in with the assigned role.
2. Upload feeder GPX.
3. Upload XLSX mapping.
4. Upload KML overlay if needed.
5. Review the validation report.
6. Trace the interruption and review:
   - confirmed path
   - mixed path
   - guessed path
   - inferred nodes/accounts
   - disconnected fragments
7. Save the interruption if it should stay in records/history.
8. Export only after checking warnings and validation.

## Upload File Expectations

### GPX

Recommended:

- Feeder point names or codes should be present
- Coordinates must be readable
- Track/route coordinates help build feeder lines
- Source/substation point should be included if possible

Common fix hints:

- If unreadable, re-export as standard GPX from Garmin or the source mapping tool
- If missing coordinates, check that the export includes waypoints or track points

### XLSX

Recommended:

- Use `.xlsx`, not `.csv`
- Include either:
  - `Pol ID` and `Account Number`
  - or `FromBusID` / `ToBusID`
- Keep KWHR numeric where possible

Common fix hints:

- Normalize messy header names before upload
- Remove merged headers or decorative title rows where practical

### KML

Recommended:

- Use plain `.kml`, not `.kmz`
- Include `Placemark` geometry:
  - `Point`
  - `LineString`
  - `Polygon`
  - `MultiGeometry`
- Keep identifying text in:
  - name
  - description
  - ExtendedData / SimpleData

Common fix hints:

- If the file came from Google Earth, export as KML instead of KMZ
- If linking is weak, include feeder-related tower identifiers in the placemark fields

Transformer handling:

- Transformer triangles are rendered only from KML `Point` placemarks whose style begins with `#DT`
- The transformer name must match the feeder rule `<feeder number>-DT...`
- Example valid transformer name:
  - `11-DT0005U`
- Example names that are preserved as normal KML features but do not get transformer triangles:
  - `DT-11-TAL0001-DTSBUS`
  - `TAL5465-DTSBUS`
  - `DX_11-DT0005U`

## Validation And Trace Confidence

The system separates operator-facing trace confidence into:

- `Confirmed Path`
- `Mixed Path`
- `Guessed Path`

Exports are still possible when warnings are present, but the workbook will now include a trace advisory when the path is not confirmed.

## Troubleshooting

### Database is busy

The app uses SQLite WAL mode and a busy timeout, but short lock windows can still happen during shared use. If the UI shows a database busy message:

1. Wait a few seconds
2. Retry the action
3. Confirm no backup or antivirus scan is holding the database file open for too long
4. Confirm the app is running from one service/process path only and not from multiple accidental launches

### GPX upload is unreadable

Check:

- the file is standard `.gpx`
- waypoint/track/route coordinates are actually present
- feeder point names were exported, not only display labels

Practical fixes:

- re-export the feeder from the source mapping tool as plain GPX
- remove non-GPX wrapper content or damaged XML
- try a smaller known-good GPX to confirm the parser path is healthy

### XLSX upload is unreadable

Check:

- the file is real `.xlsx`, not renamed `.xls` or `.csv`
- the workbook opens normally in Excel
- the sheet still contains a readable header row
- expected mapping columns still exist:
  - `Pol ID` and `Account Number`
  - or `FromBusID` / `ToBusID`

Practical fixes:

- save the workbook again as a fresh `.xlsx`
- remove decorative rows above the real header
- remove merged title cells if they broke header detection
- confirm the file is still within the configured upload limit

### KML upload is unreadable

Check:

- the file is `.kml`, not `.kmz`
- placemarks still contain geometry
- name/description/ExtendedData fields were not stripped out

Practical fixes:

- export again as plain KML
- verify the file opens in Google Earth or another KML viewer
- remove malformed placemarks if the source export is damaged

### Transformer triangle is missing or wrong

Check:

- the transformer placemark is a `Point`
- the style begins with `#DT` such as `#DT` or `#DT_N`
- the placemark name starts with the feeder number and `-DT`, for example `11-DT0005U`

Important:

- feeder line labels or support labels such as `DX_11-DT0005U`, `DT-11-TAL0001-DTSBUS`, or `TAL5465-DTSBUS` do not render as transformer triangles
- those features may still be preserved in the KML overlay, but they are not the authoritative transformer marker records

### Workspace did not restore

If a user returns to the main page and the workspace cannot be restored:

- the UI should show a clean recovery notice
- saved interruptions still remain in records/history
- the user can re-upload the feeder/XLSX/KML or reopen a saved interruption
- if only live uploaded workspace is missing after a server restore, confirm the matching `OUTAGE_WORKSPACE_CACHE_DIR` contents were also restored
- if only one component is missing, the app can still continue with the remaining restorable workspace pieces

### Export blocked by validation errors

Open the validation report and fix any `error` state before exporting. Warnings can still allow export, but should be reviewed carefully.

Check:

- feeder validation is not in `error`
- XLSX validation is not in `error`
- KML validation is not in `error`
- the current interruption still has a valid target and affected result set

## Development Notes

- Production should use `wsgi.py`
- Local development can still use `python app.py`
- The current database schema is auto-initialized on startup
- SQLite remains the system of record for users, interruptions, audit logs, and per-user workspace state
- Read-only queries now use a dedicated SQLite read context so lookup-heavy pages do not keep write-capable connections open unnecessarily
- Login/logout responses now send `no-store` cache headers, and the app also adds basic browser safety headers (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin` referrer policy)
- If OpenStreetMap tiles are blocked, privacy extensions or browser privacy tooling may be stripping the `Referer` header. Test in a normal browser tab with extensions disabled to confirm whether a client-side tool is interfering.
