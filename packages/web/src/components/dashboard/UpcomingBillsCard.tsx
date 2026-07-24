import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BILL_STATUSES,
  BILL_STATUS_LABELS,
  formatMoney,
  type AccountDTO,
  type BillStatus,
  type DuplicateCandidateDTO,
  type UpcomingBillDTO,
} from "@panditas/shared";
import { api, ApiError } from "../../api";
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
  const [duplicateCandidate, setDuplicateCandidate] = useState<DuplicateCandidateDTO | null>(null);

  const submit = useMutation({
    mutationFn: (v: { confirmDuplicate?: boolean }) =>
      api.post("/transactions/transfer", {
        fromAccountId,
        toAccountId: bill.accountId,
        postedAt,
        amount: Number(amount),
        billStatus,
        confirmDuplicate: v.confirmDuplicate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      onDone();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { candidates?: DuplicateCandidateDTO[] } | undefined;
        setDuplicateCandidate(body?.candidates?.[0] ?? null);
      }
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
        onClick={() => submit.mutate({})}
        disabled={!canSubmit || submit.isPending}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {submit.isPending ? "Saving…" : "Save"}
      </button>

      {duplicateCandidate && (
        <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>
            Looks like a duplicate of <strong>{formatMoney(duplicateCandidate.amount)}</strong> on{" "}
            {new Date(duplicateCandidate.postedAt).toLocaleDateString("en-CA")}.
          </span>
          <div className="flex shrink-0 gap-3">
            <button onClick={() => setDuplicateCandidate(null)} className="text-amber-700 underline">
              Cancel
            </button>
            <button
              onClick={() => submit.mutate({ confirmDuplicate: true })}
              className="rounded-lg bg-amber-600 px-2 py-1 font-medium text-white hover:bg-amber-700"
            >
              Add anyway
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
