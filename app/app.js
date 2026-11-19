import {
  formatIDR, parseAmount, validateMember, validateExpense, balances, settleUp, total,
} from "./logic.js";

// One bill per link: ?bill=trip-bali keeps its own members and expenses.
const BILL = (new URLSearchParams(location.search).get("bill") || "default").replace(/[^\w-]/g, "").slice(0, 40) || "default";
const KEY = `patungan:v1:${BILL}`;
const $ = (id) => document.getElementById(id);

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.members) && Array.isArray(s.expenses)) return s;
  } catch (e) { /* storage unavailable or corrupt */ }
  return { members: [], expenses: [] };
}

let state = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

function li(text, cls) {
  const el = document.createElement("li");
  el.textContent = text;
  if (cls) el.className = cls;
  return el;
}

function span(cls, text) {
  const el = document.createElement("span");
  el.className = cls;
  el.textContent = text;
  return el;
}

// Stable colour per person, so Andi is always the same colour.
function hue(name) {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

let freshExpense = false;

function render() {
  const { members, expenses } = state;

  $("member-list").replaceChildren(...members.map((m) => {
    const el = document.createElement("li");
    const av = span("avatar", m.slice(0, 1).toUpperCase());
    av.style.setProperty("--h", hue(m));
    av.setAttribute("aria-hidden", "true");
    el.append(av, m);
    return el;
  }));
  if (!members.length) $("member-list").append(li("No members yet", "empty"));

  const payer = $("expense-payer");
  const prevPayer = payer.value;
  payer.replaceChildren(...members.map((m) => new Option(m, m)));
  if (members.includes(prevPayer)) payer.value = prevPayer;

  // New members start ticked; people the user un-ticked stay un-ticked.
  const unchecked = new Set(
    [...document.querySelectorAll("#split-options input:not(:checked)")].map((i) => i.value),
  );
  $("split-options").replaceChildren(...members.map((m) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = m;
    box.checked = !unchecked.has(m);
    label.append(box, m);
    return label;
  }));
  if (!members.length) $("split-options").append(span("meta", "Add members first"));

  $("expense-list").replaceChildren(...expenses.map((e, i) => {
    const el = document.createElement("li");
    const line = span("line", "");
    line.append(span("what", e.description), span("dots", ""), span("amt", formatIDR(e.amount)));
    el.append(line, span("meta", ` paid by ${e.payer}, split among ${e.splitAmong.join(", ")}`));
    el.setAttribute("aria-label", `${e.description}: ${formatIDR(e.amount)}, paid by ${e.payer}, split among ${e.splitAmong.join(", ")}`);
    if (freshExpense && i === expenses.length - 1) el.className = "fresh";
    return el;
  }));
  freshExpense = false;
  if (!expenses.length) $("expense-list").append(li("No expenses yet", "empty"));
  $("total").textContent = formatIDR(total(expenses));

  const bal = balances(members, expenses);
  $("balance-list").replaceChildren(...members.map((m) => {
    const v = bal[m];
    const [cls, state] = v > 0 ? ["pos", `gets back ${formatIDR(v)}`]
      : v < 0 ? ["neg", `owes ${formatIDR(-v)}`] : ["zero", "is settled"];
    const el = document.createElement("li");
    el.className = cls;
    el.append(span("who", m), " ", span("state", state));
    return el;
  }));
  if (!members.length) $("balance-list").append(li("Add members to see balances", "empty"));

  const transfers = settleUp(bal);
  $("settle-list").replaceChildren(...transfers.map((t) => li(
    `${t.from} pays ${t.to} ${formatIDR(t.amount)}`,
  )));
  if (!transfers.length) $("settle-list").append(li("Everyone is settled up", "empty"));
}

$("member-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const res = validateMember($("member-name").value, state.members);
  $("member-error").textContent = res.ok ? "" : res.error;
  if (!res.ok) return;
  state.members.push(res.name);
  $("member-name").value = "";
  save();
  render();
  $("member-name").focus();
});

$("expense-form").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const expense = {
    description: $("expense-desc").value.trim(),
    amount: parseAmount($("expense-amount").value),
    payer: $("expense-payer").value,
    splitAmong: [...document.querySelectorAll("#split-options input:checked")].map((i) => i.value),
  };
  const res = validateExpense(expense, state.members);
  $("expense-error").textContent = res.ok ? "" : res.error;
  if (!res.ok) return;
  state.expenses.push(expense);
  $("expense-desc").value = "";
  $("expense-amount").value = "";
  $("split-options").replaceChildren(); // next expense defaults to everyone
  freshExpense = true;
  save();
  render();
});

$("reset").addEventListener("click", () => {
  state = { members: [], expenses: [] };
  save();
  $("member-error").textContent = "";
  $("expense-error").textContent = "";
  render();
});

render();
