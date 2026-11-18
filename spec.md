# Patungan — product spec

Patungan splits shared bills between friends and tells everyone who pays whom.
This file is the single source of truth: every `## R…` requirement below becomes a
Kane CLI test (`tests/<id>_test.md`) with `specloop gen`. Each bullet is one test step,
written in plain English. The last bullet of each requirement must verify something.

## R1: Add members to the group
- Type "Andi" into the Member name field and click Add member. Do the same for "Budi" and "Citra".
- Verify the Members list shows Andi, Budi and Citra.

## R2: Reject duplicate member names
- Add the members "Andi" and "Budi".
- Try to add "andi" again (lowercase) by typing it into the Member name field and clicking Add member. The app is expected to refuse it.
- Verify an error saying Andi is already in the group is shown, and the Members list still contains exactly two names: Andi and Budi.

## R3: Add an expense and show the total
- Add the members "Andi", "Budi" and "Citra".
- In Add expense, enter Description "Dinner", Amount 90000, choose Andi in Paid by, keep all three ticked under Split among, and click Add expense.
- Verify the Expenses list shows Dinner for Rp 90.000 paid by Andi, and Total spent shows Rp 90.000.

## R4: Balances show who owes and who gets money back
- Add the members "Andi", "Budi" and "Citra".
- Add an expense with Description "Dinner", Amount 90000, Paid by Andi, split among all three.
- Verify the Balances list says Andi gets back Rp 60.000, Budi owes Rp 30.000 and Citra owes Rp 30.000.

## R5: Split only among the people who were ticked
- Add the members "Andi", "Budi" and "Citra".
- Add an expense with Description "Taxi", Amount 50000, Paid by Budi, and untick Citra under Split among so only Andi and Budi are ticked. Click Add expense.
- Verify the Balances list says Budi gets back Rp 25.000, Andi owes Rp 25.000 and Citra is settled.

## R6: Settle up in the fewest transfers
- Add the members "Andi", "Budi" and "Citra".
- Add an expense "Dinner", Amount 90000, Paid by Andi, split among all three.
- Add an expense "Taxi", Amount 30000, Paid by Budi, split among all three.
- Verify the Settle up list shows exactly two transfers: Citra pays Andi Rp 40.000 and Budi pays Andi Rp 10.000.

## R7: Refuse an expense with an invalid amount
- Add the members "Andi" and "Budi".
- Try to add an expense with Description "Snacks" and Amount 0 by clicking Add expense. The app is expected to refuse it.
- Verify an error saying the amount must be greater than 0 is shown, and the Expenses list still says No expenses yet.

## R8: Data survives a page reload
- Add the members "Andi" and "Budi", then add an expense "Coffee", Amount 40000, Paid by Andi, split among both.
- Reload the page.
- Verify the Members list still shows Andi and Budi, the Expenses list still shows Coffee for Rp 40.000, and Total spent shows Rp 40.000.
