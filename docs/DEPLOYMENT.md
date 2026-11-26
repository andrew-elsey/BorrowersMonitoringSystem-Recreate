# Deployment guide: department PC on the LAN

How to run the app on the department PC and reach it from other machines on the network (HRD-4). It assumes Windows 11, Docker Desktop (set to start at login), Node.js 24 (the version in `.nvmrc`, because `npm run backup` runs Node on the PC itself), the repo cloned on the PC, and a fixed address for the PC (a static IP, or a DHCP reservation on the router). Variables are described in `.env.example` and `docs/ARCHITECTURE.md` section 10.

## 1. Keep it off the internet

The app is built for the department LAN only. The protections in `docs/ARCHITECTURE.md` section 12 stop cheap attacks (floods, slow connections, huge requests, login spamming), but they cannot stop an attack big enough to saturate the PC or its network link, and the app serves plain HTTP. So:

- Never forward a router port to this PC and never publish it through a public address.
- Publish only the web port. Never publish the api or db ports.
- For access from outside, use a VPN into the LAN. If the app must ever be public, it needs a CDN or WAF in front, HTTPS, and `COOKIE_SECURE=true` (ARCHITECTURE 12.1).

## 2. Set up `.env`

```
cp .env.example .env
```

In PowerShell use `Copy-Item .env.example .env`. Edit `.env` (never commit it):

| Variable | What to set |
|---|---|
| `POSTGRES_PASSWORD` | Required. Letters and digits only. |
| `ADMIN_PASSWORD` | Required, at least 10 characters. Wrap it in single quotes if it contains `$` or `#`. |
| `SESSION_SECRET` | Required. A long random string, for example the output of `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `COOKIE_SECURE` | Keep `false`. The LAN uses plain HTTP, and browsers drop a secure cookie on HTTP, so nobody could sign in. |
| `WEB_BIND_ADDRESS` | The PC's LAN address, for example `192.168.1.20`. The default `127.0.0.1` reaches the app from this PC only. |
| `WEB_PORT` | Port people use. Default `8080`. |
| `BACKUP_DIR` | Folder for backups, outside the repo, for example `C:\bms-backups` (section 5). |

Leave the others at their defaults (timezone `Asia/Manila`, `SESSION_TTL_HOURS=8`). Leave `QA_PASSWORD` empty: it is for development only.

## 3. First start and first sign-in

```
docker compose up -d --build
```

The api applies the database migrations, then creates the first admin (`ADMIN_USERNAME`, default `admin`, with `ADMIN_PASSWORD`) and the default settings. `ADMIN_PASSWORD` only matters on the first start: changing it later does not change the admin's password.

1. Open `http://<LAN address>:8080` (the address in `WEB_BIND_ADDRESS`; `127.0.0.1` no longer works once it is set) and sign in as the admin.
2. Change the admin password (Change password).
3. Open Settings and semesters and set the values in section 7.

Docker Desktop restarts the containers when it starts (`restart: unless-stopped`). In Docker Desktop settings, turn on "Start Docker Desktop when you sign in to your computer". The app starts only after someone signs in, so after a Windows Update restart it stays down until someone signs in to the PC.

Never let the PC sleep. A sleeping PC cannot be reached from the LAN, and the closing-time flagging does not run until the api next restarts. In Settings, System, Power, set "When plugged in, put my device to sleep after" to Never, or in PowerShell run `powercfg /change standby-timeout-ac 0`. The screen may still turn off.

## 4. Let other machines in (firewall)

Docker publishes the port on the address from `WEB_BIND_ADDRESS`; Windows Firewall must also allow it. In an administrator PowerShell, allow the web port from the department subnet only (change the port and subnet to yours):

```
New-NetFirewallRule -DisplayName "BMS web" -Direction Inbound -Protocol TCP -LocalPort 8080 -Profile Private -RemoteAddress 192.168.1.0/24 -Action Allow
```

From another machine on the LAN, open `http://<LAN address>:8080` and sign in. If it does not load, check: the PC's address with `ipconfig` matches `WEB_BIND_ADDRESS` (after a change run `docker compose up -d`); the firewall rule exists; the Windows network profile is Private, not Public. A Block rule for "Docker Desktop Backend" (made by clicking Cancel on Docker's first firewall prompt) overrides any Allow rule: delete it in Windows Defender Firewall, Inbound Rules. If the PC's address changes, the app is unreachable until `.env` is fixed, which is why the address must be fixed.

Then test a reboot: restart the PC, sign in, wait for Docker Desktop, and open the app from another machine again. If Docker starts before the network has the PC's address (common on Wi-Fi or a slow network), the web container cannot use `WEB_BIND_ADDRESS` and the app stays down; `docker compose ps` shows web not running. If that happens, set `WEB_BIND_ADDRESS=0.0.0.0` and run `docker compose up -d`. The app then listens on every network of the PC, and the firewall rule above becomes the only thing that limits it to the department subnet, so keep that rule, keep the network profile Private, and make sure no other Allow rule (for example one for "Docker Desktop Backend") opens the port to everyone.

## 5. Backups

`npm run backup` makes a `pg_dump` file (session data is not included).

1. Make the folder outside the repo and outside anything the web serves, for example `C:\bms-backups`, and set `BACKUP_DIR=C:\bms-backups` in `.env`.
2. Let only the Windows account that runs the backups use it. Get `<account>` by running `whoami` in a normal PowerShell; administrator rights are not needed for this step:

   ```
   icacls C:\bms-backups /inheritance:r /grant:r "<account>:(OI)(CI)F"
   ```

3. Run `npm install` once in the repo (the script runs on the host with Node), then try `npm run backup`. It writes `bms-YYYYMMDD-HHmmss.dump` (the PC's local time) and, only after a good backup, deletes `bms-*.dump` files older than 14 days. Backups are kept 14 days.
4. Schedule it daily in Task Scheduler: Create Task. Trigger: Daily, at a time the PC is reliably on and someone is signed in, for example 30 minutes after closing time. Action "Start a program": program is the full path from `(Get-Command npm.cmd).Source` (usually `C:\Program Files\nodejs\npm.cmd`), arguments `run backup`, and **Start in** is the repo folder (no quotes). The folder matters: the script finds the compose project and `.env` from it. Docker Desktop must be running, so choose "Run only when user is logged on", and in Settings tick "Run task as soon as possible after a scheduled start is missed".
5. Run the task once from Task Scheduler and check that a new file appears.

Now and then copy the backups to another disk or machine: a backup on the same PC does not survive a dead disk.

## 6. Restore

```
npm run restore -- C:\bms-backups\bms-20261120-170000.dump
```

It checks the file, asks you to type the database name, stops the api, replaces all data in one transaction (a failed restore leaves the database as it was), and starts the api again. Every session is gone afterwards, so everyone signs in again.

- Restore only into the same app version that made the backup. An older backup restored after a migration added a table makes the api's `migrate deploy` fail on start. If that happens, check out the version that made the backup and run `docker compose up -d --build`; or restore, then rebuild that version.
- A restore replaces everything. Run a fresh `npm run backup` first if the current data matters.

## 7. Settings, in plain terms

Admins set these in Settings and semesters. The server enforces them (`docs/BUSINESS_RULES.md`).

- **Closing time** (default 17:00, local time). Everything is expected back the same day. Items still out after closing time are flagged.
- **Strike thresholds** (defaults 3, 4, 5; each must be higher than the one before). A flagged item is a strike against the borrower for the semester. At the first threshold the borrower gets a warning, at the second a stricter notice, and at the third the borrower is blocked. An admin can override a flag (a reason is required).
- **Current semester.** Strikes are counted per semester. Create the semester with its dates and mark it current. A new semester starts everyone at zero, so set the next one at the start of each semester.

## 8. Day to day

- Staff sign in and record checkouts and returns; borrowers never sign in.
- After an error while saving a checkout or return, check the borrower's open items (or the dashboard) before entering it again, so it is not recorded twice.
- Every morning (or at least weekly), check that the newest file in the backup folder is from the last working day. A backup job can fail without any message.
- If the app does not respond, run `docker compose ps` and `docker compose logs api`.
- Audit check: `docker compose exec api npm run audit:sweep` lists records with no audit entry. It changes nothing and exits 1 when it finds problems.
- Lost admin password: `docker compose exec api npm run admin:reset-password -- <username>` (asks for the new password at a hidden prompt).
- Update to a new version: run a backup, then `git pull` and `docker compose up --build -d`. Migrations run on start.

## 9. Load test on the department PC

Once after setup, re-run the abuse and load test on this PC and compare the numbers with `docs/ARCHITECTURE.md` section 12.7:

```
LOAD_FULL=1 LOAD_REQUIRE_HRD=1 npm run test:load
```

In PowerShell: `$env:LOAD_FULL=1; $env:LOAD_REQUIRE_HRD=1; npm run test:load`. It takes about 35 minutes and uses port 18180. Run it outside opening hours, and run `npm install` first (the seed and autocannon come from the host's `node_modules`). It builds its own throwaway compose project (`bms-load`) and does not touch the real data.

Keep more than 10 GB free on `C:` as a safety margin: Docker crashed once on the dev machine with about 3 GB free. Check with `Get-PSDrive C` and `docker system df`. Afterwards clean up with `docker image rm bms-load-api bms-load-web` and `docker builder prune`. The prune also clears the real app's build cache, so the next `docker compose up --build` takes longer.

`npm run test:nginx` is a developer check. It uses the fixed Docker subnet `172.29.188.0/24`: do not run it on a LAN that uses that range.
