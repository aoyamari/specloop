import {
  formatIDR, parseAmount, validateMember, validateExpense, balances, settleUp, total,
} from "./logic.js";

const KEY = "patungan:v1";
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

function render() {
  const { members, expenses } = state;

  $("member-list").replaceChildren(...members.map((m) => li(m)));
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
    label.className = "check";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = m;
    box.checked = !unchecked.has(m);
    label.append(box, ` ${m}`);
    return label;
  }));

  $("expense-list").replaceChildren(...expenses.map((e) => li(
    `${e.description}: ${formatIDR(e.amount)}, paid by ${e.payer}, split among ${e.splitAmong.join(", ")}`,
  )));
  if (!expenses.length) $("expense-list").append(li("No expenses yet", "empty"));
  $("total").textContent = formatIDR(total(expenses));

  const bal = balances(members, expenses);
  $("balance-list").replaceChildren(...members.map((m) => {
    const v = bal[m];
    if (v > 0) return li(`${m} gets back ${formatIDR(v)}`, "pos");
    if (v < 0) return li(`${m} owes ${formatIDR(-v)}`, "neg");
    return li(`${m} is settled`, "zero");
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
