require("dotenv").config();

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");

const dataDirectory = path.join(__dirname, "data");
fs.mkdirSync(dataDirectory, { recursive: true });

const databasePath = path.join(dataDirectory, "justwait.sqlite");
const db = new Database(databasePath);

db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

const schema = fs.readFileSync(
  path.join(__dirname, "db", "schema.sql"),
  "utf8"
);
db.exec(schema);

const serviceSeeds = [
  {
    key: "affairs",
    name: "Student Affairs",
    description: "Enrollment, student records, and general student services.",
    prefix: "A"
  },
  {
    key: "it",
    name: "IT Support",
    description: "Accounts, campus Wi-Fi, software, and technical assistance.",
    prefix: "IT"
  },
  {
    key: "advising",
    name: "Academic Advising",
    description: "Course planning, degree progress, and academic guidance.",
    prefix: "ADV"
  }
];

// The five confirmed Academic Advisors. Each one gets an independent queue.
// "key" is the queue's internal name; it must stay unique.
const advisorSeeds = [
  { name: "Ahmed Yehia",     email: "ahmed.yehia@justwait.local",     key: "advising_ahmed_yehia" },
  { name: "Ahmed Arafa",     email: "ahmed.arafa@justwait.local",     key: "advising_ahmed_arafa" },
  { name: "Ahmed Antar",     email: "ahmed.antar@justwait.local",     key: "advising_ahmed_antar" },
  { name: "Mostafa Soliman", email: "mostafa.soliman@justwait.local", key: "advising_mostafa_soliman" },
  { name: "Reda El-Basiony", email: "reda.elbasiony@justwait.local",  key: "advising_reda_elbasiony" }
];

// If you already have a database made with the old "Advisor 1..5" placeholders,
// rename those rows in place so tickets and queue ids are kept.
const oldPlaceholders = db.transaction(() => {
  advisorSeeds.forEach((advisor, index) => {
    const n = index + 1;
    db.prepare("UPDATE staff SET full_name = ?, email = ? WHERE email = ?")
      .run(advisor.name, advisor.email, `advisor${n}@justwait.local`);
    db.prepare("UPDATE queues SET queue_key = ? WHERE queue_key = ?")
      .run(advisor.key, `advising_advisor${n}`);
  });
});
oldPlaceholders();

const seed = db.transaction(() => {
  const insertService = db.prepare(`
    INSERT OR IGNORE INTO services
      (service_key, name, description, ticket_prefix)
    VALUES (?, ?, ?, ?)
  `);

  for (const service of serviceSeeds) {
    insertService.run(
      service.key,
      service.name,
      service.description,
      service.prefix
    );
  }

  const demoPassword = process.env.STAFF_DEMO_PASSWORD || "JustWaitDemo123!";
  const passwordHash = bcrypt.hashSync(demoPassword, 10);

  const insertStaff = db.prepare(`
    INSERT OR IGNORE INTO staff
      (full_name, email, password_hash, role, service_key)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertStaff.run(
    "Student Affairs Staff",
    "studentaffairs@justwait.local",
    passwordHash,
    "student_affairs",
    "affairs"
  );

  insertStaff.run(
    "IT Support Staff",
    "itsupport@justwait.local",
    passwordHash,
    "it_support",
    "it"
  );

  for (const advisor of advisorSeeds) {
    insertStaff.run(
      advisor.name,
      advisor.email,
      passwordHash,
      "advisor",
      "advising"
    );
  }

  const serviceId = db.prepare(
    "SELECT service_id FROM services WHERE service_key = ?"
  );

  const affairsId = serviceId.get("affairs").service_id;
  const itId = serviceId.get("it").service_id;
  const advisingId = serviceId.get("advising").service_id;

  const insertQueue = db.prepare(`
    INSERT OR IGNORE INTO queues (queue_key, service_id, advisor_staff_id)
    VALUES (?, ?, ?)
  `);

  insertQueue.run("affairs", affairsId, null);
  insertQueue.run("it", itId, null);

  const findStaff = db.prepare("SELECT staff_id FROM staff WHERE email = ?");
  for (const advisor of advisorSeeds) {
    const staffRow = findStaff.get(advisor.email);
    insertQueue.run(advisor.key, advisingId, staffRow.staff_id);
  }
});

seed();

// Close unfinished tickets from earlier Cairo-local dates. Without this, an old
// active ticket would be invisible on today's dashboard while still blocking
// that student from joining the same queue again. server.js runs it at startup
// and then every minute, so it also works if the server stays on past midnight.
db.closeOldTickets = function closeOldTickets() {
  const cairoToday = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());

  db.prepare(`
    UPDATE tickets
    SET status = 'Absent', updated_at = CURRENT_TIMESTAMP
    WHERE queue_date < ?
      AND status IN ('Waiting', 'Skipped', 'Now serving')
  `).run(cairoToday);
};
db.closeOldTickets();

module.exports = db;
