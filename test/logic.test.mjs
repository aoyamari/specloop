import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatIDR, parseAmount, validateMember, validateExpense, shares, balances, settleUp, total,
} from "../app/logic.js";

test("formatIDR uses dot thousands separators", () => {
  assert.equal(formatIDR(90000), "Rp 90.000");
  assert.equal(formatIDR(1234567), "Rp 1.234.567");
  assert.equal(formatIDR(0), "Rp 0");
});

test("parseAmount accepts common formats", () => {
  assert.equal(parseAmount("90000"), 90000);
  assert.equal(parseAmount("Rp 90.000"), 90000);
  assert.ok(Number.isNaN(parseAmount("")));
});

test("duplicate members are rejected case-insensitively", () => {
  assert.equal(validateMember("andi", ["Andi"]).ok, false);
  assert.equal(validateMember("  ", []).ok, false);
  assert.equal(validateMember(" Budi ", ["Andi"]).name, "Budi");
});

test("expense validation", () => {
  const m = ["Andi", "Budi"];
  assert.equal(validateExpense({ description: "x", amount: 0, payer: "Andi", splitAmong: m }, m).ok, false);
  assert.equal(validateExpense({ description: "x", amount: 10, payer: "Andi", splitAmong: [] }, m).ok, false);
  assert.equal(validateExpense({ description: "x", amount: 10, payer: "Andi", splitAmong: m }, m).ok, true);
});

test("shares always add up to the amount", () => {
  const s = shares(100, ["A", "B", "C"]);
  assert.equal(s.A + s.B + s.C, 100);
});

test("spec R4: dinner split three ways", () => {
  const b = balances(["Andi", "Budi", "Citra"], [
    { description: "Dinner", amount: 90000, payer: "Andi", splitAmong: ["Andi", "Budi", "Citra"] },
  ]);
  assert.deepEqual(b, { Andi: 60000, Budi: -30000, Citra: -30000 });
});

test("spec R5: only ticked people share", () => {
  const b = balances(["Andi", "Budi", "Citra"], [
    { description: "Taxi", amount: 50000, payer: "Budi", splitAmong: ["Andi", "Budi"] },
  ]);
  assert.deepEqual(b, { Andi: -25000, Budi: 25000, Citra: 0 });
});

test("spec R6: two transfers settle the group", () => {
  const all = ["Andi", "Budi", "Citra"];
  const ex = [
    { description: "Dinner", amount: 90000, payer: "Andi", splitAmong: all },
    { description: "Taxi", amount: 30000, payer: "Budi", splitAmong: all },
  ];
  assert.equal(total(ex), 120000);
  assert.deepEqual(settleUp(balances(all, ex)), [
    { from: "Citra", to: "Andi", amount: 40000 },
    { from: "Budi", to: "Andi", amount: 10000 },
  ]);
});
