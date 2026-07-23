import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BILL_STATUSES,
  BILL_STATUS_LABELS,
  formatMoney,
  type AccountDTO,
  type BillStatus,
  type UpcomingBillDTO,
} from "@panditas/shared";
import { api } from "../../api";
import { Card } from "../ui/Card";
import { SectionHeader } from "../ui/SectionHeader";
import { Combobox, type ComboboxItem } from "../ui/Combobox";
import { transactionsLink } from "../../lib/transactionsLink";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function fromAccountOptions(accounts: AccountDTO[]): ComboboxItem[] {
  return [
    { value: "", label: "Paid from…" },
    ...accounts.filter((a) => a.type !== "credit_card" && !a.mergedIntoId).map((a) => ({ value: a.id, label: a.displayName })),
  ];
}

export function UpcomingBillsCard({ bills }: { bills: UpcomingBillDTO[] }) {
  // Shared, not per-card — only one "mark as paid" form open at a time, so a
  // card never has to grow in place (which would misalign its row-mates).
  const [activeBillId, setActiveBillId] = useState<string | null>(null);
  if (bills.length === 0) return null;
  const activeBill = bills.find((b) => b.accountId === activeBillId) ?? null;

  return (
    <section>
      <SectionHeader>Bills due in the next 14 days</SectionHeader>
      <Card>
        <div className="flex flex-wrap gap-3">
          {bills.map((b) => (
            <BillCard
              key={b.accountId}
              bill={b}
              isFormOpen={b.accountId === activeBillId}
              onToggleForm={() => setActiveBillId((id) => (id === b.accountId ? null : b.accountId))}
            />
          ))}
        </div>

        {activeBill && (
          <MarkPaidForm
            bill={activeBill}
            onDone={() => setActiveBillId(null)}
          />
        )}
      </Card>
    </section>
  );
}

function BillCard({
  bill,
  isFormOpen,
  onToggleForm,
}: {
  bill: UpcomingBillDTO;
  isFormOpen: boolean;
  onToggleForm: () => void;
}) {
  const latestPayment = bill.payments[bill.payments.length - 1] ?? null;
  const hasMultiplePayments = bill.payments.length > 1;

  return (
    <div
      className={`min-w-[11rem] flex-1 rounded-lg border p-3 text-sm ${isFormOpen ? "border-accent-300 bg-accent-50/40" : "border-slate-200"}`}
    >
      <Link to={transactionsLink({ accountId: bill.accountId })} className="hover:underline">
        <p className="font-medium text-slate-800">{bill.name}</p>
      </Link>
      <p className="text-xs text-slate-500">
        Due {new Date(bill.dueDate).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
        {bill.estimate !== null && ` · est. ${formatMoney(bill.estimate, bill.currency)}`}
      </p>

      {latestPayment ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-green-500" title="Paid this cycle" />
          <span>
            {formatMoney(latestPayment.amount, bill.currency)} on{" "}
            {new Date(latestPayment.postedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
          </span>
          {hasMultiplePayments && (
            <span
              title={`${bill.payments.length} payments found this cycle — check Transactions in case one's a duplicate`}
              className="cursor-help text-amber-500"
            >
              ⚠
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={onToggleForm}
          className="mt-1.5 rounded-lg border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          {isFormOpen ? "Cancel" : "Mark as paid"}
        </button>
      )}
    </div>
  );
}

function MarkPaidForm({ bill, onDone }: { bill: UpcomingBillDTO; onDone: () => void }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api.get<AccountDTO[]>("/accounts"),
  });

  const [fromAccountId, setFromAccountId] = useState("");
  const [postedAt, setPostedAt] = useState(todayDate());
  const [amount, setAmount] = useState("");
  const [billStatus, setBillStatus] = useState<BillStatus>("full");

  const submit = useMutation({
    mutationFn: () =>
      api.post("/transactions/card-payment", {
        cardAccountId: bill.accountId,
        fromAccountId,
        postedAt,
        amount: Number(amount),
        billStatus,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onDone();
    },
  });

  const canSubmit = fromAccountId && postedAt && Number(amount) > 0;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-accent-200 bg-accent-50/40 p-3">
      <p className="w-full text-xs font-semibold text-slate-600">Mark {bill.name} as paid</p>
      <label className="text-xs font-medium text-slate-600">
        From
        <Combobox
          options={fromAccountOptions(accounts.data ?? [])}
          value={fromAccountId}
          onChange={setFromAccountId}
          className="mt-1 w-40"
          inputClassName="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Date
        <input
          type="date"
          value={postedAt}
          onChange={(e) => setPostedAt(e.target.value)}
          className="mt-1 block w-32 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Amount
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="mt-1 block w-24 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
        />
      </label>
      <label className="text-xs font-medium text-slate-600">
        Coverage
        <select
          value={billStatus}
          onChange={(e) => setBillStatus(e.target.value as BillStatus)}
          className="mt-1 block w-28 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs"
        >
          {BILL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {BILL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => submit.mutate()}
        disabled={!canSubmit || submit.isPending}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {submit.isPending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
