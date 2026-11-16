# JustWait — Short Technical Explanation

## Architecture

The browser displays the HTML pages and uses JavaScript `fetch()` to send HTTP requests to the Express backend. Express validates each request, checks the signed-in user's session and permissions, applies the queue rules, and reads or updates SQLite. The backend returns JSON, and the frontend updates the page.

## Why keep a backend?

The student website and staff dashboard may be opened on different devices. They need one shared source of queue data. The backend is the safe middle layer between those browsers and the database; browsers should not connect directly to SQLite.

## Why SQLite?

SQLite stores the project data in one local database file. It supports SQL tables, primary keys, foreign keys, constraints, and queries without requiring a separately installed database server.

## Why polling?

The frontend requests updated queue data every few seconds. This is easier to implement and explain than WebSockets and is sufficient for a small classroom demonstration.

## Why are there six tables?

- `students` and `staff` keep the two account types separate.
- `services` describes the service categories.
- `queues` represents the actual shared or advisor-specific queues.
- `queue_counters` generates ticket numbers independently for each queue and date.
- `tickets` stores each student's place and status.

The six-table design avoids creating a separate database table for every queue. All queues reuse the same `tickets` table.

## How to explain a Join Queue action

1. The student selects a queue and submits the form.
2. Frontend JavaScript sends `POST /api/tickets` with the selected `queueId`.
3. Express checks that the student is signed in.
4. The backend checks whether the student already has an active ticket in that queue.
5. A transaction increments that queue's daily counter and inserts the ticket.
6. The backend returns the ticket number and position as JSON.
7. The frontend redirects to the ticket page and polls for changes.

## What is deliberately out of scope?

React, WebSockets, cloud hosting, a separate administrator dashboard, and a complex deployment setup. The project focuses on frontend fundamentals, basic backend routes, SQL, sessions, and queue logic.
