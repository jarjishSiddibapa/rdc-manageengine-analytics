# Set up RDC ManageEngine SR Analytics on another PC

Windows, about 20 minutes plus download time. Commands are for **PowerShell**.

## 1. Install once on the new PC

| What | Where | Notes |
|---|---|---|
| Git | <https://git-scm.com/download/win> | accept the defaults |
| Node.js, current **LTS** | <https://nodejs.org> | 22.12 or newer (20.19+ also works) |
| MySQL Server | <https://dev.mysql.com/downloads/mysql/> | the old PC runs **9.5**; install that version or newer. Set a root password, keep "run as a Windows service" and "start at system startup". It includes `mysqldump`, used for backups. |

There is nothing else to prepare: no Python and no virtual environment. `startup.bat` installs the libraries into the two `node_modules` folders and builds the screens by itself.

## 2. On the old PC: collect three files

1. Start the app (restart it first if it was already running when the project was updated), open **Admin > Backups** and press **Run a backup now**.
2. Copy these to a USB drive (or another private channel):

| File | Why |
|---|---|
| the newest `backend\db-backup\manageengine-analytics-....sql` | all SRs and their history, users, settings, inactive technicians |
| `backend\.env` | database settings, ManageEngine connection, first administrator |
| `backend\.secret` | the key that unlocks passwords saved under Admin > Connections |

These three hold passwords and company data. They are deliberately **not** on GitHub: never upload or email them.

## 3. On the new PC: get the project

```powershell
git clone https://github.com/jarjishSiddibapa/rdc-manageengine-analytics.git C:\rdc-analytics
```

Copy `.env` and `.secret` into `C:\rdc-analytics\backend\`.

Open `C:\rdc-analytics\backend\.env` in Notepad and set `DB_PASSWORD` to the MySQL password of **this** PC (and `DB_USER` if it is not `root`).

## 4. Restore the data

Put the `.sql` file in `C:\transfer\`, change the file name below to yours, and run it. It asks for the MySQL password. It takes a few minutes and creates the database `manageengine_analytics`, replacing one of that name if it exists.

```powershell
cmd /c '"C:\Program Files\MySQL\MySQL Server 9.5\bin\mysql.exe" -u root -p --default-character-set=utf8mb4 < "C:\transfer\manageengine-analytics-YYYYMMDD-HHMMSS.sql"'
```

(If you installed another MySQL version, change `9.5` in the path.)

**Starting empty instead?** Skip this step. The app creates an empty database and the first administrator from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. Then open **Data & sync** and press **Deep Sync SRs**; collecting every SR's history for the first time takes about two hours.

## 5. Start it

Double-click `C:\rdc-analytics\startup.bat`. The first run needs internet and takes a few minutes. Leave the window open and go to <http://localhost:7780>.

After a restore, sign in with the same accounts as on the old PC. The email account comes across too (with `.env` and `.secret`); check it with **Admin > Connections > Send a test email**. If **Web address** was set for the old PC, change or blank it, so emailed links point to the new one.

| `startup.bat` says | Do this |
|---|---|
| Node.js is not installed / too old | install the current LTS, then open `startup.bat` again |
| `backend\.env` was created and opened | you skipped step 3: replace it with your copy |
| MySQL is not reachable | start the MySQL service (Windows Services), check `DB_HOST` / `DB_PORT` |
| Port 7780 is already in use | the app is already running, or set another `PORT` in `.env` |
| a library or build error, such as "not a valid Win32 application" or "Cannot find native binding" | a damaged library, often from an install that was cut short. The script installs the libraries afresh and tries again by itself. If it still fails, check that antivirus is not blocking the folder, delete the `node_modules` folders inside `backend` and `frontend`, and run it again with internet |

Do not copy the `node_modules` folders from another PC, and do not close the window while libraries are installing.

## 6. Decide which PC syncs

Both PCs use the same ManageEngine access, and ManageEngine throttles heavy use. Either stop the app on the old PC, or on one of the two switch off the automatic sync and the daily deep sync under **Admin > Settings > Sync & history**.

## 7. Optional

**Let other people on your network open it.** Set `HOST=0.0.0.0` in `.env` and restart. The startup window then shows the address to give them, for example `http://192.168.0.84:7780`, and emailed links use it by themselves (leave **Web address** blank, unless you want a name or an https address instead). Reserve the PC's address in the router so it does not change.

If other PCs cannot connect, allow the port in an **administrator** PowerShell. This rule works when Windows lists the network as private or domain (**Settings > Network & internet**); mark your office network as private first if it shows as public.

```powershell
New-NetFirewallRule -DisplayName "RDC SR Analytics" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 7780 -Profile Domain,Private -RemoteAddress LocalSubnet
```

If Windows asked to allow Node.js on public networks and you agreed, the app is also reachable on any public network that PC joins. The connection is not encrypted: use it only on a trusted network, or put HTTPS in front and set `TRUST_PROXY`.

**Start automatically when someone signs in to Windows:** press `Win + R`, type `shell:startup`, and place a shortcut to `startup.bat` there.

**Daily deep sync and backup:** they run at night, so set Windows power options so the PC does not sleep. A run that was missed happens at the next start.

## Updating later

Close the app window, run this, then double-click `startup.bat`. It installs any new libraries and rebuilds the screens as needed.

```powershell
git -C C:\rdc-analytics pull
```
