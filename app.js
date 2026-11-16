/* JustWait frontend — all queue data comes from the Express API, not localStorage. */
"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const API = "/api";

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  let data = {};
  try { data = await response.json(); } catch (_) {}
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function setMessage(element, message, kind = "") {
  if (!element) return;
  element.textContent = message || "";
  element.className = `form-message ${kind}`.trim();
}

function setBusy(button, busy, busyText = "Please wait…") {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

const ICONS = {
  affairs: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  it: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 20h20"/>',
  advising: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'
};
function icon(key) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[key] || ICONS.affairs}</svg>`;
}
function themeFor(key) {
  const themes = {
    affairs: ["#e8604f", "#fdecea"],
    it: ["#3b7ea1", "#e6f1f7"],
    advising: ["#d19a1f", "#fbf1d9"]
  };
  return themes[key] || themes.affairs;
}
function applyTheme(element, serviceKey) {
  const [color, tint] = themeFor(serviceKey);
  element.style.setProperty("--accent", color);
  element.style.setProperty("--tint", tint);
}

// Shows "My ticket" and "Sign out" in the header when a student is signed in.
async function initStudentBar() {
  const nav = $(".header-actions");
  if (!nav) return;
  try {
    const { account } = await api("/me");
    if (!account || account.type !== "student") return;
    const staffLink = $(".staff", nav);
    const myTicket = document.createElement("a");
    myTicket.className = "staff";
    myTicket.href = "ticket.html";
    myTicket.textContent = "My ticket";
    const signOut = document.createElement("a");
    signOut.className = "staff";
    signOut.href = "#";
    signOut.textContent = `Sign out (${account.student.full_name.split(" ")[0]})`;
    signOut.addEventListener("click", async event => {
      event.preventDefault();
      try { await api("/logout", { method: "POST" }); } catch (_) {}
      location.href = "index.html";
    });
    nav.insertBefore(myTicket, staffLink);
    nav.insertBefore(signOut, staffLink);
  } catch (_) { /* header links are optional */ }
}

async function initHome() {
  const grid = $("#services");
  const message = $("#home-message");

  async function render() {
    try {
      const { services } = await api("/services");
      const previousAdvisorSelection = $("#advisor-choice")?.value || "";
      const groups = {
        affairs: services.filter(item => item.serviceKey === "affairs"),
        it: services.filter(item => item.serviceKey === "it"),
        advising: services.filter(item => item.serviceKey === "advising")
      };

      grid.innerHTML = Object.entries(groups).map(([serviceKey, queues]) => {
        if (!queues.length) return "";
        const first = queues[0];
        const isAdvising = serviceKey === "advising";
        const selector = isAdvising ? `
          <label for="advisor-choice">Choose your advisor</label>
          <select class="advisor-select" id="advisor-choice">
            <option value="">Select an advisor</option>
            ${queues.map(queue => `<option value="${queue.id}">${escapeHTML(queue.advisor)}</option>`).join("")}
          </select>` : "";
        const queue = isAdvising ? null : first;
        return `
          <article class="card" id="card-${serviceKey}" data-service="${serviceKey}">
            <div class="card-top"><span class="icon">${icon(serviceKey)}</span><span class="open">Available</span></div>
            <h2>${escapeHTML(first.name)}</h2>
            <p>${escapeHTML(first.description)}</p>
            ${selector}
            <div class="stats">
              <div><b class="waiting-count">${queue ? queue.waiting : "—"}</b><span>Waiting now</span></div>
              <div><b class="serving-count">${queue ? queue.serving : "—"}</b><span>Being served</span></div>
            </div>
            <a class="btn join-link" href="${queue ? `join.html?queueId=${queue.id}` : "#"}" ${isAdvising ? 'aria-disabled="true"' : ""}>Join queue <span aria-hidden="true">→</span></a>
          </article>`;
      }).join("");

      const advisorSelectAfterRender = $("#advisor-choice");
      if (advisorSelectAfterRender && previousAdvisorSelection) {
        advisorSelectAfterRender.value = previousAdvisorSelection;
      }

      Object.entries(groups).forEach(([serviceKey, queues]) => {
        const card = $(`#card-${serviceKey}`);
        if (!card) return;
        applyTheme(card, serviceKey);
        const select = $("#advisor-choice", card);
        const refreshCard = () => {
          const selected = select ? queues.find(queue => String(queue.id) === select.value) : queues[0];
          $(".waiting-count", card).textContent = selected ? selected.waiting : "—";
          $(".serving-count", card).textContent = selected ? selected.serving : "—";
          const link = $(".join-link", card);
          if (selected) {
            link.href = `join.html?queueId=${selected.id}`;
            link.removeAttribute("aria-disabled");
          } else {
            link.href = "#";
            link.setAttribute("aria-disabled", "true");
          }
        };
        if (select) select.addEventListener("change", refreshCard);
        refreshCard();
      });

      setMessage(message, "Choose a service to view its queue.", "success");
    } catch (error) {
      setMessage(message, `${error.message}. Make sure the JustWait server is running.`, "error");
      grid.innerHTML = '<p class="empty-state">Services are temporarily unavailable. Please refresh in a moment.</p>';
    }
  }

  await render();
  window.setInterval(render, 5000);
}

async function initJoin() {
  const params = new URLSearchParams(location.search);
  const queueId = Number(params.get("queueId"));
  const form = $("#join-form");
  const message = $("#join-message");
  const submit = $("#join-submit");
  const nameField = $("#name-field");
  const nameInput = $("#name");
  const idInput = $("#sid");
  const passwordInput = $("#student-password");
  const registerButton = $("#register-mode");
  const loginButton = $("#login-mode");
  let mode = "register";
  let selectedQueue = null;

  function setMode(nextMode) {
    mode = nextMode;
    const registering = mode === "register";
    nameField.hidden = !registering;
    nameInput.required = registering;
    passwordInput.autocomplete = registering ? "new-password" : "current-password";
    registerButton.setAttribute("aria-pressed", String(registering));
    loginButton.setAttribute("aria-pressed", String(!registering));
    submit.textContent = registering ? "Create account and join →" : "Sign in and join →";
    setMessage(message, "");
  }

  registerButton.addEventListener("click", () => setMode("register"));
  loginButton.addEventListener("click", () => setMode("login"));

  try {
    const { services } = await api("/services");
    selectedQueue = services.find(item => item.id === queueId);
    if (!selectedQueue) {
      setMessage(message, "This queue could not be found. Please choose a service again.", "error");
      submit.disabled = true;
      return;
    }
    applyTheme(document.body, selectedQueue.serviceKey);
    $("#join-title").textContent = `Join ${selectedQueue.name}`;
    $("#service-title").textContent = selectedQueue.name;
    $("#summary-icon").innerHTML = icon(selectedQueue.serviceKey);
    $("#queue-note").textContent = selectedQueue.advisor
      ? `Your selected advisor is ${selectedQueue.advisor}.`
      : "Queue numbers and positions update automatically.";
    const updateSummary = async () => {
      const data = await api("/services");
      const latest = data.services.find(item => item.id === queueId);
      if (!latest) return;
      $("#waiting").textContent = latest.waiting;
      $("#serving").textContent = latest.serving;
    };
    await updateSummary();
    window.setInterval(() => updateSummary().catch(() => {}), 5000);
  } catch (error) {
    setMessage(message, `${error.message}. Please return to the home page.`, "error");
    submit.disabled = true;
    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    setMessage(message, "");
    const universityId = idInput.value.trim();
    const fullName = nameInput.value.trim();
    const password = passwordInput.value;

    if (!universityId) return setMessage(message, "Enter your student ID.", "error");
    if (mode === "register" && !fullName) return setMessage(message, "Enter your full name.", "error");
    if (password.length < (mode === "register" ? 8 : 1)) {
      return setMessage(message, mode === "register" ? "Use a password with at least 8 characters." : "Enter your password.", "error");
    }

    setBusy(submit, true, mode === "register" ? "Creating account…" : "Signing in…");
    try {
      if (mode === "register") {
        await api("/students/register", {
          method: "POST",
          body: JSON.stringify({ universityId, fullName, password })
        });
      } else {
        await api("/students/login", {
          method: "POST",
          body: JSON.stringify({ universityId, password })
        });
      }

      const result = await api("/tickets", {
        method: "POST",
        body: JSON.stringify({ queueId })
      });
      location.href = `ticket.html?ticketId=${result.ticket.id}`;
    } catch (error) {
      if (mode === "register" && error.status === 409) {
        setMessage(message, "This student ID already has an account. Choose “I already have an account” to sign in.", "error");
      } else {
        setMessage(message, error.message, "error");
      }
    } finally {
      setBusy(submit, false);
    }
  });
}

async function initTicket() {
  const box = $("#ticket");
  let ticketId = Number(new URLSearchParams(location.search).get("ticketId"));

  // No ticket in the address? Ask the server for this student's active ticket.
  if (!ticketId) {
    try {
      const { ticket } = await api("/tickets/current");
      if (ticket) ticketId = ticket.id;
    } catch (_) { /* not signed in: handled below */ }
  }

  if (!ticketId) {
    box.innerHTML = '<h1>No ticket selected</h1><p class="lead" style="margin:12px 0 24px">Join a queue to receive your ticket.</p><a class="btn" href="index.html">View services</a>';
    return;
  }

  async function render() {
    try {
      const { ticket } = await api(`/tickets/${ticketId}`);
      applyTheme(box, ticket.serviceKey);
      const terminal = ["Completed", "Absent"].includes(ticket.status);
      box.innerHTML = `
        <p class="eyebrow">Your JustWait ticket</p>
        <div class="ticket-number">${escapeHTML(ticket.number)}</div>
        <h1 style="font-size:1.8rem;margin:12px 0">${escapeHTML(ticket.service)}</h1>
        ${ticket.advisor ? `<p class="muted">Advisor: ${escapeHTML(ticket.advisor)}</p>` : ""}
        <p style="margin:18px 0"><span class="ticket-status" data-status="${escapeHTML(ticket.status)}">${escapeHTML(ticket.status)}</span></p>
        <p class="lead" style="margin:0 0 18px;font-size:15px">${terminal
          ? "This ticket is no longer active. You can return to the services page if you need another appointment."
          : "Keep this page open. Your queue position and ticket status refresh automatically."}</p>
        <div class="ticket-meta">
          <div class="row"><span>Your position</span><b>${ticket.position == null ? "—" : ticket.position}</b></div>
          <div class="row"><span>Student name</span><b>${escapeHTML(ticket.studentName || "—")}</b></div>
          <div class="row"><span>Student ID</span><b>${escapeHTML(ticket.studentUniversityId || "—")}</b></div>
        </div>
        <a class="btn ghost" href="index.html">Back to services</a>`;
    } catch (error) {
      if (error.status === 401) {
        box.innerHTML = '<h1>Please sign in</h1><p class="lead" style="margin:12px 0 24px">Sign in through the join page to view your ticket.</p><a class="btn" href="index.html">View services</a>';
      } else {
        box.innerHTML = `<p class="form-message error">${escapeHTML(error.message)}</p>`;
      }
    }
  }

  await render();
  window.setInterval(render, 3000);
}

async function initLogin() {
  const form = $("#login-form");
  const message = $("#login-error");
  const button = $("#login-submit");
  form.addEventListener("submit", async event => {
    event.preventDefault();
    setMessage(message, "");
    setBusy(button, true, "Signing in…");
    try {
      await api("/staff/login", {
        method: "POST",
        body: JSON.stringify({
          email: $("#email").value.trim(),
          password: $("#password").value
        })
      });
      location.href = "dashboard.html";
    } catch (error) {
      setMessage(message, error.message, "error");
    } finally {
      setBusy(button, false);
    }
  });
}

async function initDashboard() {
  const message = $("#dashboard-message");
  const lists = $("#lists");
  let refreshInProgress = false;

  $("#signout").addEventListener("click", async () => {
    try { await api("/logout", { method: "POST" }); } catch (_) {}
    location.href = "index.html";
  });

  async function render() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
      const { account } = await api("/me");
      if (!account || account.type !== "staff") {
        location.href = "login.html";
        return;
      }
      $("#staff-identity").textContent = `${account.fullName} · ${account.role.replaceAll("_", " ")}`;
      const { queues } = await api("/staff/queues");
      if (!queues.length) {
        lists.innerHTML = '<p class="empty-state">No queue is assigned to this account.</p>';
        return;
      }

      const queueData = await Promise.all(queues.map(async queue => ({
        queue,
        ...(await api(`/staff/queues/${queue.queue_id}/tickets`))
      })));

      lists.innerHTML = queueData.map(({ queue, tickets }) => `
        <section class="panel" data-queue-id="${queue.queue_id}">
          <div class="panel-head">
            <div>
              <h2>${escapeHTML(queue.name)}${queue.advisor_name ? ` — ${escapeHTML(queue.advisor_name)}` : ""}</h2>
              <p class="queue-count">${queue.waiting} waiting · ${queue.serving} currently serving</p>
            </div>
            <button class="btn call-next" type="button" data-action="call-next" data-queue-id="${queue.queue_id}" ${queue.serving > 0 ? "disabled" : ""}>${queue.serving > 0 ? "Serving in progress" : "Call next"}</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Ticket</th><th>Student</th><th>Student ID</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                ${tickets.map(ticket => `
                  <tr data-ticket-id="${ticket.id}">
                    <td><strong>${escapeHTML(ticket.number)}</strong></td>
                    <td>${escapeHTML(ticket.studentName || "—")}</td>
                    <td>${escapeHTML(ticket.studentUniversityId || "—")}</td>
                    <td>${escapeHTML(ticket.status)}</td>
                    <td><div class="action-buttons">
                      ${ticket.status === "Now serving" ? `
                        <button class="btn small secondary" data-action="status" data-status="Completed" data-ticket-id="${ticket.id}">Complete</button>
                        <button class="btn small neutral" data-action="status" data-status="Absent" data-ticket-id="${ticket.id}">Absent</button>
                      ` : `
                        <button class="btn small warning" data-action="status" data-status="Skipped" data-ticket-id="${ticket.id}">Skip</button>
                        <button class="btn small neutral" data-action="status" data-status="Absent" data-ticket-id="${ticket.id}">Absent</button>
                      `}
                    </div></td>
                  </tr>`).join("") || '<tr><td colspan="5" class="empty-state">No active tickets in this queue.</td></tr>'}
              </tbody>
            </table>
          </div>
        </section>
      `).join("");

      setMessage(message, "Queue data is up to date.", "success");
    } catch (error) {
      if (error.status === 401) {
        location.href = "login.html";
      } else {
        setMessage(message, error.message, "error");
      }
    } finally {
      refreshInProgress = false;
    }
  }

  lists.addEventListener("click", async event => {
    const button = event.target.closest("button[data-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    button.disabled = true;
    try {
      if (action === "call-next") {
        const result = await api(`/staff/queues/${button.dataset.queueId}/call-next`, { method: "POST" });
        setMessage(message, result.message, "success");
      } else if (action === "status") {
        const result = await api(`/staff/tickets/${button.dataset.ticketId}/status`, {
          method: "PATCH",
          body: JSON.stringify({ status: button.dataset.status })
        });
        setMessage(message, result.message, "success");
      }
      await render();
    } catch (error) {
      setMessage(message, error.message, "error");
      await render();
    } finally {
      button.disabled = false;
    }
  });

  await render();
  window.setInterval(render, 4000);
}

const pageInitializers = {
  home: initHome,
  join: initJoin,
  ticket: initTicket,
  login: initLogin,
  dashboard: initDashboard
};

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (["home", "join", "ticket"].includes(page)) initStudentBar();
  if (pageInitializers[page]) pageInitializers[page]();
});
