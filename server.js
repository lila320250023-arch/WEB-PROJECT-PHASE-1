require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

app.disable("x-powered-by");
app.use(express.json({ limit: "20kb" }));
app.use(express.urlencoded({ extended: false }));

app.use(session({
  name: "justwait.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 8
  }
}));

// Do not expose the database, environment file, or backend source as static files.
app.use((req, res, next) => {
  const blocked = /^\/(data|db|node_modules)(\/|$)|^\/(server|db)\.js$|^\/\.(env|git)|^\/(package(-lock)?\.json|README\.md|TECHNICAL_OVERVIEW\.md)$/i;
  if (blocked.test(req.path)) return res.sendStatus(404);
  next();
});

// The existing HTML/CSS/JS files remain in the repository root for now.
app.use(express.static(ROOT, { index: "index.html" }));

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
}).format(new Date());

function requireStudent(req, res, next) {
  if (req.session.account?.type !== "student") {
    return res.status(401).json({ error: "Please sign in as a student." });
  }
  next();
}

function requireStaff(req, res, next) {
  if (req.session.account?.type !== "staff") {
    return res.status(401).json({ error: "Please sign in as staff." });
  }
  next();
}

function cleanText(value, maxLength = 100) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getStudentById(id) {
  return db.prepare(`
    SELECT student_id, university_id, full_name
    FROM students WHERE student_id = ?
  `).get(id);
}

function getQueue(queueId) {
  return db.prepare(`
    SELECT q.queue_id, q.queue_key, q.advisor_staff_id,
           s.service_key, s.name AS service_name, s.ticket_prefix,
           st.full_name AS advisor_name
    FROM queues q
    JOIN services s ON s.service_id = q.service_id
    LEFT JOIN staff st ON st.staff_id = q.advisor_staff_id
    WHERE q.queue_id = ?
  `).get(queueId);
}

function queueStats(queueId) {
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('Waiting', 'Skipped') THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status = 'Now serving' THEN 1 ELSE 0 END) AS serving
    FROM tickets
    WHERE queue_id = ? AND queue_date = ?
  `).get(queueId, today());

  return {
    waiting: Number(stats.waiting || 0),
    serving: Number(stats.serving || 0)
  };
}

function ticketPosition(ticket) {
  if (ticket.status === "Now serving") return 1;
  if (!["Waiting", "Skipped"].includes(ticket.status)) return null;

  const ahead = db.prepare(`
    SELECT COUNT(*) AS total
    FROM tickets
    WHERE queue_id = ?
      AND queue_date = ?
      AND (
        status = 'Now serving'
        OR (status IN ('Waiting', 'Skipped') AND queue_order < ?)
      )
  `).get(ticket.queue_id, ticket.queue_date, ticket.queue_order);

  return Number(ahead.total) + 1;
}

function serializeTicket(ticket) {
  return {
    id: ticket.ticket_id,
    number: ticket.ticket_number,
    status: ticket.status,
    queueId: ticket.queue_id,
    queueDate: ticket.queue_date,
    position: ticketPosition(ticket),
    service: ticket.service_name,
    serviceKey: ticket.service_key,
    advisor: ticket.advisor_name || null,
    studentName: ticket.student_name || null,
    studentUniversityId: ticket.university_id || null,
    createdAt: ticket.created_at
  };
}

function canManageQueue(staff, queue) {
  if (!staff || !queue) return false;

  if (staff.role === "advisor") {
    return queue.service_key === "advising" &&
      queue.advisor_staff_id === staff.staff_id;
  }

  return (
    staff.role === "student_affairs" && queue.service_key === "affairs"
  ) || (
    staff.role === "it_support" && queue.service_key === "it"
  );
}

function requireQueueAccess(req, res, next) {
  const queue = getQueue(Number(req.params.queueId));
  if (!queue || !canManageQueue(req.session.account, queue)) {
    return res.status(403).json({ error: "You cannot access this queue." });
  }
  req.queue = queue;
  next();
}

function ticketDetails(ticketId) {
  return db.prepare(`
    SELECT t.*, q.queue_id, s.name AS service_name, s.service_key,
           st.full_name AS advisor_name,
           students.full_name AS student_name,
           students.university_id
    FROM tickets t
    JOIN queues q ON q.queue_id = t.queue_id
    JOIN services s ON s.service_id = q.service_id
    JOIN students ON students.student_id = t.student_id
    LEFT JOIN staff st ON st.staff_id = q.advisor_staff_id
    WHERE t.ticket_id = ?
  `).get(ticketId);
}

app.get("/api/health", (req, res) => {
  res.json({ ok: true, app: "JustWait API" });
});

// ---------- Authentication ----------

app.post("/api/students/register", (req, res) => {
  const universityId = cleanText(req.body.universityId, 40).toUpperCase();
  const fullName = cleanText(req.body.fullName, 100);
  const password = typeof req.body.password === "string" ? req.body.password : "";

  if (!universityId || !fullName || password.length < 8) {
    return res.status(400).json({
      error: "Enter your student ID, full name, and a password of at least 8 characters."
    });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const result = db.prepare(`
      INSERT INTO students (university_id, full_name, password_hash)
      VALUES (?, ?, ?)
    `).run(universityId, fullName, passwordHash);

    req.session.account = {
      type: "student",
      studentId: Number(result.lastInsertRowid)
    };

    res.status(201).json({
      message: "Student account created.",
      student: {
        universityId,
        fullName
      }
    });
  } catch (error) {
    if (String(error.code).startsWith("SQLITE_CONSTRAINT")) {
      return res.status(409).json({ error: "That student ID already has an account." });
    }
    console.error(error);
    res.status(500).json({ error: "Could not create the student account." });
  }
});

app.post("/api/students/login", (req, res) => {
  const universityId = cleanText(req.body.universityId, 40).toUpperCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const student = db.prepare(`
    SELECT student_id, university_id, full_name, password_hash
    FROM students WHERE university_id = ? COLLATE NOCASE
  `).get(universityId);

  if (!student || !bcrypt.compareSync(password, student.password_hash)) {
    return res.status(401).json({ error: "Student ID or password is incorrect." });
  }

  req.session.account = { type: "student", studentId: student.student_id };
  res.json({
    message: "Signed in.",
    student: { universityId: student.university_id, fullName: student.full_name }
  });
});

app.post("/api/staff/login", (req, res) => {
  const email = cleanText(req.body.email, 150).toLowerCase();
  const password = typeof req.body.password === "string" ? req.body.password : "";

  const staff = db.prepare(`
    SELECT staff_id, full_name, email, password_hash, role, service_key
    FROM staff WHERE email = ? COLLATE NOCASE
  `).get(email);

  if (!staff || !bcrypt.compareSync(password, staff.password_hash)) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }

  req.session.account = {
    type: "staff",
    staff_id: staff.staff_id,
    full_name: staff.full_name,
    email: staff.email,
    role: staff.role,
    service_key: staff.service_key
  };

  res.json({
    message: "Signed in.",
    staff: {
      fullName: staff.full_name,
      email: staff.email,
      role: staff.role,
      serviceKey: staff.service_key
    }
  });
});

app.get("/api/me", (req, res) => {
  const account = req.session.account || null;
  if (!account) return res.json({ account: null });

  if (account.type === "student") {
    const student = getStudentById(account.studentId);
    return res.json({ account: { type: "student", student } });
  }

  res.json({
    account: {
      type: "staff",
      fullName: account.full_name,
      email: account.email,
      role: account.role,
      serviceKey: account.service_key
    }
  });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("justwait.sid");
    res.json({ message: "Signed out." });
  });
});

// ---------- Public services and queues ----------

app.get("/api/services", (req, res) => {
  const queues = db.prepare(`
    SELECT q.queue_id, q.queue_key, s.service_key, s.name,
           s.description, s.ticket_prefix, st.full_name AS advisor_name
    FROM queues q
    JOIN services s ON s.service_id = q.service_id
    LEFT JOIN staff st ON st.staff_id = q.advisor_staff_id
    ORDER BY s.service_id, q.queue_id
  `).all();

  res.json({
    services: queues.map(queue => ({
      id: queue.queue_id,
      key: queue.queue_key,
      serviceKey: queue.service_key,
      name: queue.name,
      description: queue.description,
      prefix: queue.ticket_prefix,
      advisor: queue.advisor_name,
      ...queueStats(queue.queue_id)
    }))
  });
});

// ---------- Student tickets ----------

app.post("/api/tickets", requireStudent, (req, res) => {
  const queueId = Number(req.body.queueId);
  const queue = getQueue(queueId);

  if (!queue) return res.status(404).json({ error: "Queue not found." });

  const studentId = req.session.account.studentId;
  const queueDate = today();

  const joinQueue = db.transaction(() => {
    db.closeOldTickets();
    const active = db.prepare(`
      SELECT ticket_id
      FROM tickets
      WHERE student_id = ? AND queue_id = ?
        AND status IN ('Waiting', 'Skipped', 'Now serving')
    `).get(studentId, queueId);

    if (active) {
      const existing = ticketDetails(active.ticket_id);
      return { existing: true, ticket: serializeTicket(existing) };
    }

    db.prepare(`
      INSERT INTO queue_counters (queue_id, queue_date, last_number)
      VALUES (?, ?, 0)
      ON CONFLICT(queue_id, queue_date) DO NOTHING
    `).run(queueId, queueDate);

    const counter = db.prepare(`
      SELECT last_number FROM queue_counters
      WHERE queue_id = ? AND queue_date = ?
    `).get(queueId, queueDate);

    const nextNumber = counter.last_number + 1;

    db.prepare(`
      UPDATE queue_counters
      SET last_number = ?
      WHERE queue_id = ? AND queue_date = ?
    `).run(nextNumber, queueId, queueDate);

    const maxOrder = db.prepare(`
      SELECT COALESCE(MAX(queue_order), 0) AS max_order
      FROM tickets WHERE queue_id = ? AND queue_date = ?
    `).get(queueId, queueDate).max_order;

    const ticketNumber = `${queue.ticket_prefix}-${String(nextNumber).padStart(3, "0")}`;

    const result = db.prepare(`
      INSERT INTO tickets
        (queue_id, student_id, queue_date, ticket_number, queue_order)
      VALUES (?, ?, ?, ?, ?)
    `).run(queueId, studentId, queueDate, ticketNumber, maxOrder + 1);

    return {
      existing: false,
      ticket: serializeTicket(ticketDetails(Number(result.lastInsertRowid)))
    };
  });

  try {
    const result = joinQueue();
    res.status(result.existing ? 200 : 201).json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Could not join this queue." });
  }
});

app.get("/api/tickets/current", requireStudent, (req, res) => {
  const ticket = db.prepare(`
    SELECT t.ticket_id
    FROM tickets t
    WHERE t.student_id = ?
      AND t.status IN ('Waiting', 'Skipped', 'Now serving')
    ORDER BY t.created_at DESC
    LIMIT 1
  `).get(req.session.account.studentId);

  if (!ticket) return res.json({ ticket: null });
  res.json({ ticket: serializeTicket(ticketDetails(ticket.ticket_id)) });
});

app.get("/api/tickets/:ticketId", requireStudent, (req, res) => {
  const ticket = ticketDetails(Number(req.params.ticketId));

  if (!ticket || ticket.student_id !== req.session.account.studentId) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  res.json({ ticket: serializeTicket(ticket) });
});

// ---------- Staff dashboard ----------

app.get("/api/staff/queues", requireStaff, (req, res) => {
  let queues;

  if (req.session.account.role === "advisor") {
    queues = db.prepare(`
      SELECT q.queue_id, q.queue_key, s.service_key, s.name,
             s.ticket_prefix, st.full_name AS advisor_name
      FROM queues q
      JOIN services s ON s.service_id = q.service_id
      JOIN staff st ON st.staff_id = q.advisor_staff_id
      WHERE q.advisor_staff_id = ?
    `).all(req.session.account.staff_id);
  } else {
    queues = db.prepare(`
      SELECT q.queue_id, q.queue_key, s.service_key, s.name,
             s.ticket_prefix, NULL AS advisor_name
      FROM queues q
      JOIN services s ON s.service_id = q.service_id
      WHERE s.service_key = ?
    `).all(req.session.account.service_key);
  }

  res.json({
    queues: queues.map(queue => ({
      ...queue,
      ...queueStats(queue.queue_id)
    }))
  });
});

app.get("/api/staff/queues/:queueId/tickets", requireStaff, requireQueueAccess, (req, res) => {
  const tickets = db.prepare(`
    SELECT t.ticket_id
    FROM tickets t
    WHERE t.queue_id = ? AND t.queue_date = ?
      AND t.status IN ('Waiting', 'Skipped', 'Now serving')
    ORDER BY
      CASE WHEN t.status = 'Now serving' THEN 0 ELSE 1 END,
      t.queue_order ASC
  `).all(req.queue.queue_id, today());

  res.json({
    tickets: tickets.map(row => serializeTicket(ticketDetails(row.ticket_id)))
  });
});

app.post("/api/staff/queues/:queueId/call-next", requireStaff, requireQueueAccess, (req, res) => {
  const callNext = db.transaction(() => {
    const current = db.prepare(`
      SELECT ticket_id
      FROM tickets
      WHERE queue_id = ? AND queue_date = ? AND status = 'Now serving'
      LIMIT 1
    `).get(req.queue.queue_id, today());

    if (current) {
      return { conflict: true };
    }

    const next = db.prepare(`
      SELECT ticket_id
      FROM tickets
      WHERE queue_id = ? AND queue_date = ?
        AND status IN ('Waiting', 'Skipped')
      ORDER BY queue_order ASC
      LIMIT 1
    `).get(req.queue.queue_id, today());

    if (!next) return { empty: true };

    db.prepare(`
      UPDATE tickets
      SET status = 'Now serving', updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
    `).run(next.ticket_id);

    return { ticket: serializeTicket(ticketDetails(next.ticket_id)) };
  });

  const result = callNext();
  if (result.conflict) {
    return res.status(409).json({
      error: "Complete or mark the currently serving ticket absent before calling the next student."
    });
  }
  if (result.empty) return res.status(404).json({ error: "There are no waiting tickets." });

  res.json({ message: `Now serving ${result.ticket.number}.`, ticket: result.ticket });
});

app.patch("/api/staff/tickets/:ticketId/status", requireStaff, (req, res) => {
  const ticket = ticketDetails(Number(req.params.ticketId));
  if (!ticket || !canManageQueue(req.session.account, getQueue(ticket.queue_id))) {
    return res.status(404).json({ error: "Ticket not found." });
  }

  const status = cleanText(req.body.status, 30);
  if (!["Skipped", "Completed", "Absent"].includes(status)) {
    return res.status(400).json({
      error: "Choose Skipped, Completed, or Absent. Use Call next to set Now serving."
    });
  }

  const activeStatuses = ["Waiting", "Skipped", "Now serving"];
  if (!activeStatuses.includes(ticket.status)) {
    return res.status(409).json({ error: "This ticket is no longer active." });
  }
  if (status === "Completed" && ticket.status !== "Now serving") {
    return res.status(409).json({ error: "Only the currently serving ticket can be completed." });
  }
  if (status === "Skipped" && !["Waiting", "Skipped"].includes(ticket.status)) {
    return res.status(409).json({ error: "Only a waiting ticket can be skipped." });
  }

  const update = db.transaction(() => {
    let queueOrder = ticket.queue_order;

    if (status === "Skipped") {
      const maxOrder = db.prepare(`
        SELECT COALESCE(MAX(queue_order), 0) AS max_order
        FROM tickets WHERE queue_id = ? AND queue_date = ?
      `).get(ticket.queue_id, ticket.queue_date).max_order;
      queueOrder = maxOrder + 1;
    }

    db.prepare(`
      UPDATE tickets
      SET status = ?, queue_order = ?, updated_at = CURRENT_TIMESTAMP
      WHERE ticket_id = ?
    `).run(status, queueOrder, ticket.ticket_id);
  });

  update();
  res.json({
    message: `Ticket ${ticket.ticket_number} marked ${status}.`,
    ticket: serializeTicket(ticketDetails(ticket.ticket_id))
  });
});

// ---------- Error handling ----------

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

// Run the "close yesterday's tickets" cleanup every minute (see db.js).
setInterval(() => {
  try { db.closeOldTickets(); } catch (error) { console.error(error); }
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`JustWait is running at http://localhost:${PORT}`);
  console.log("Demo staff accounts use the emails in README.md.");
});
