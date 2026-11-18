// Pure bill-splitting logic. No DOM here, so it can be unit-tested with plain Node.
// All amounts are whole rupiah (integers).

export function formatIDR(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}Rp ${abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function parseAmount(input) {
  // Accepts "90000", "90.000", "Rp 90.000", "90,000"
  const digits = String(input ?? "").replace(/[^\d]/g, "");
  if (!digits) return NaN;
  return Number(digits);
}

export function validateMember(name, members) {
  const clean = String(name ?? "").trim();
  if (!clean) return { ok: false, error: "Name can't be empty" };
  const existing = members.find((m) => m.toLowerCase() === clean.toLowerCase());
  if (existing) return { ok: false, error: `${existing} is already in the group` };
  return { ok: true, name: clean };
}

export function validateExpense({ description, amount, payer, splitAmong }, members) {
  if (!String(description ?? "").trim()) return { ok: false, error: "Description can't be empty" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be greater than 0" };
  if (!members.includes(payer)) return { ok: false, error: "Choose who paid" };
  if (!Array.isArray(splitAmong) || splitAmong.length === 0) {
    return { ok: false, error: "Pick at least one person to split with" };
  }
  return { ok: true };
}

// Split an amount across people. The leftover rupiah from rounding goes to the
// first people in the list, so shares always add up to the exact amount.
export function shares(amount, people) {
  const base = Math.floor(amount / people.length);
  let rest = amount - base * people.length;
  const out = {};
  for (const p of people) {
    out[p] = base + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
  }
  return out;
}

// balance > 0: the group owes this person. balance < 0: this person owes.
export function balances(members, expenses) {
  const bal = Object.fromEntries(members.map((m) => [m, 0]));
  for (const e of expenses) {
    bal[e.payer] += e.amount;
    // Only the people ticked under "Split among" share this expense (spec R5).
    const s = shares(e.amount, e.splitAmong);
    for (const [p, v] of Object.entries(s)) bal[p] -= v;
  }
  return bal;
}

// Greedy settle-up: biggest debtor pays biggest creditor. Gives at most n-1 transfers.
export function settleUp(bal) {
  const debtors = [];
  const creditors = [];
  for (const [name, v] of Object.entries(bal)) {
    if (v < 0) debtors.push({ name, amt: -v });
    else if (v > 0) creditors.push({ name, amt: v });
  }
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = Math.min(debtors[i].amt, creditors[j].amt);
    transfers.push({ from: debtors[i].name, to: creditors[j].name, amount: pay });
    debtors[i].amt -= pay;
    creditors[j].amt -= pay;
    if (debtors[i].amt === 0) i += 1;
    if (creditors[j].amt === 0) j += 1;
  }
  return transfers;
}

export function total(expenses) {
  return expenses.reduce((s, e) => s + e.amount, 0);
}
