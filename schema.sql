PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS services (
    service_id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    ticket_prefix TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS staff (
    staff_id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (
        role IN ('student_affairs', 'it_support', 'advisor')
    ),
    service_key TEXT NOT NULL CHECK (
        service_key IN ('affairs', 'it', 'advising')
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    university_id TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS queues (
    queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_key TEXT NOT NULL UNIQUE,
    service_id INTEGER NOT NULL,
    advisor_staff_id INTEGER UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (service_id) REFERENCES services(service_id),
    FOREIGN KEY (advisor_staff_id) REFERENCES staff(staff_id)
);

CREATE TABLE IF NOT EXISTS queue_counters (
    queue_id INTEGER NOT NULL,
    queue_date TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (queue_id, queue_date),
    FOREIGN KEY (queue_id) REFERENCES queues(queue_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tickets (
    ticket_id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id INTEGER NOT NULL,
    student_id INTEGER NOT NULL,
    queue_date TEXT NOT NULL,
    ticket_number TEXT NOT NULL,
    queue_order INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Waiting' CHECK (
        status IN ('Waiting', 'Skipped', 'Now serving', 'Completed', 'Absent')
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (queue_id) REFERENCES queues(queue_id),
    FOREIGN KEY (student_id) REFERENCES students(student_id),
    UNIQUE (queue_id, queue_date, ticket_number)
);

CREATE INDEX IF NOT EXISTS idx_tickets_queue_status_order
ON tickets(queue_id, status, queue_order);

CREATE INDEX IF NOT EXISTS idx_tickets_student
ON tickets(student_id, created_at);

-- A student may have only one active ticket in a particular queue.
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_ticket_per_student_queue
ON tickets(student_id, queue_id)
WHERE status IN ('Waiting', 'Skipped', 'Now serving');
