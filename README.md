# JustWait — University Queue Management System

A course-project prototype for joining university service queues online and managing them through a staff dashboard.

## 1. Technology

- **Frontend:** HTML, CSS, browser JavaScript
- **Backend:** Node.js + Express
- **Database:** SQLite (`better-sqlite3`)
- **Communication:** JavaScript `fetch()` requests to the Express API
- **Queue refresh:** polling (the pages request updated data every few seconds)

The website is served by Express. Do not open the HTML files directly with `file://`.

## 2. Project structure

```text
JustWait/
├── index.html          Home page and service selection
├── join.html           Student registration/login and queue joining
├── ticket.html         Student ticket and live position
├── login.html          Staff sign-in
├── dashboard.html      Staff queue dashboard
├── styles.css          Shared styling
├── app.js              Frontend behavior and API requests
├── server.js           Express routes and session handling
├── db.js               SQLite setup and demo data
├── db/
│   └── schema.sql      Database table definitions
├── data/
│   └── justwait.sqlite Created automatically on first run
├── package.json        Dependencies and npm scripts
└── .env.example        Example local configuration
```

## 3. Queue model

The database is configured with:

- One shared **Student Affairs** queue.
- One separate **IT Support** queue.
- One individual queue per Academic Advisor.

The starter data creates one queue for each of the five Academic Advisors: Ahmed Yehia, Ahmed Arafa, Ahmed Antar, Mostafa Soliman and Reda El-Basiony. The advisor list is the `advisorSeeds` array in `db.js`. An older database that still has the `Advisor 1–5` placeholders is renamed automatically the next time the server starts.

Finance is not a separate queue in this version.

## 4. Database tables

The project uses six small tables because each has a distinct responsibility:

| Table | Purpose |
|---|---|
| `students` | Student accounts and password hashes |
| `staff` | Staff accounts, roles, and service assignment |
| `services` | Service types such as Student Affairs, IT, and Advising |
| `queues` | The shared queues and individual advisor queues |
| `queue_counters` | Daily ticket-number counter for each queue |
| `tickets` | Student tickets, positions, dates, and statuses |

SQLite creates `data/justwait.sqlite` automatically when the backend starts. Foreign-key enforcement is enabled.

## 5. Install and run

### Requirements

Install the current Node.js LTS version. npm is included with Node.js.

### Install dependencies

Open a terminal **inside the `JustWait` folder** and run:

```bash
npm install
```

### Create the environment file

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace `SESSION_SECRET` with a long random value. Set `STAFF_DEMO_PASSWORD` to a password you will use for local testing.

Configure the demo password before the first run. The initial staff accounts are created only when the database is first initialized; changing the environment variable later does not automatically change existing account passwords.

### Check the JavaScript files

```bash
npm run check
```

### Start JustWait

```bash
npm start
```

Then open this address in your browser:

```text
http://localhost:3000
```

Keep the terminal window running while you use the website. Stop the server with `Ctrl + C`.

For development with automatic server restart:

```bash
npm run dev
```

## 6. Demo staff accounts

All demo staff accounts use the password set in `.env` as `STAFF_DEMO_PASSWORD`.

| Staff role | Demo email |
|---|---|
| Student Affairs | `studentaffairs@justwait.local` |
| IT Support | `itsupport@justwait.local` |
| Ahmed Yehia | `ahmed.yehia@justwait.local` |
| Ahmed Arafa | `ahmed.arafa@justwait.local` |
| Ahmed Antar | `ahmed.antar@justwait.local` |
| Mostafa Soliman | `mostafa.soliman@justwait.local` |
| Reda El-Basiony | `reda.elbasiony@justwait.local` |

These are local classroom demo accounts, not official university accounts. Use fictional student details for demonstrations. Student IDs are not verified against university records.

## 7. Main workflow

1. A student selects Student Affairs, IT Support, or an individual advisor.
2. The student creates an account or signs in.
3. JustWait creates a ticket in the selected queue.
4. The student ticket page displays the ticket number, status, and queue position.
5. The assigned staff member signs in and opens their dashboard.
6. Staff can call the next ticket, skip a ticket, mark a student absent, or complete a ticket.
7. Student pages and staff dashboards poll the backend for updated queue information.

### Ticket statuses

- `Waiting` — waiting in the queue.
- `Skipped` — moved to the back of the active queue.
- `Now serving` — currently being served.
- `Completed` — service finished.
- `Absent` — no longer active in the queue.

Ticket numbers restart by queue each Cairo-local day. Any unfinished tickets from an earlier day are marked `Absent` when the server starts and then every minute, so they do not remain hidden while blocking a student from joining again.

## 8. API overview

All API routes are prefixed with `/api`. Request and response bodies use JSON.

### General

- `GET /api/health` — check that the backend is running.
- `GET /api/services` — list services, queues, and current counts.
- `GET /api/me` — get the signed-in account.
- `POST /api/logout` — end the current session.

### Student

- `POST /api/students/register` — create a student account.
- `POST /api/students/login` — sign in as a student.
- `POST /api/tickets` — join a selected queue.
- `GET /api/tickets/current` — get the student's current active ticket.
- `GET /api/tickets/:ticketId` — get one of the signed-in student's tickets.

### Staff

- `POST /api/staff/login` — sign in as staff.
- `GET /api/staff/queues` — list queues assigned to the signed-in staff member.
- `GET /api/staff/queues/:queueId/tickets` — list active tickets in an assigned queue.
- `POST /api/staff/queues/:queueId/call-next` — call the next ticket.
- `PATCH /api/staff/tickets/:ticketId/status` — update a ticket to `Skipped`, `Completed`, or `Absent`.

## 9. Important project limitations

This is a local classroom prototype, not a production university deployment.

- The default Express session store keeps sessions in server memory. That is acceptable for local testing, but a deployed system would need a persistent session store.
- Use HTTPS and stronger operational/security controls before any real deployment.
- Student IDs are entered by the user and are not checked against E-JUST records.
- The demo staff accounts use local `.local` emails and a shared demo password; change the password in `.env` before a formal demonstration.
- Polling is intentionally used instead of WebSockets to keep the project understandable and manageable.

## 10. Resetting demo data

Stop the server first. To start with a completely fresh database, delete:

```text
data/justwait.sqlite
```

Then run `npm start` again. The database and demo accounts will be recreated. **Deleting this file permanently removes all locally stored demo tickets and student accounts.**
