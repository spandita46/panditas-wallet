import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMoney, type PiggyBankData } from "@panditas/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

export function KidHomePage() {
  const { user, refresh } = useAuth();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ["piggybank"],
    queryFn: () => api.get<PiggyBankData>("/piggybank"),
  });

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cheer, setCheer] = useState<string | null>(null);

  const add = useMutation({
    mutationFn: (direction: "in" | "out") =>
      api.post("/piggybank/transactions", {
        direction,
        amount: Number(amount),
        description: note.trim() || (direction === "in" ? "Money in" : "Spent"),
      }),
    onSuccess: (_res, direction) => {
      setAmount("");
      setNote("");
      setError(null);
      setCheer(direction === "in" ? "Yay! Your savings grew! 🎉" : "Got it! 🛍️");
      setTimeout(() => setCheer(null), 2500);
      queryClient.invalidateQueries({ queryKey: ["piggybank"] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : "Oops, try again!"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/piggybank/transactions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["piggybank"] }),
  });

  async function logout() {
    await api.post("/auth/logout");
    refresh();
  }

  const balance = data?.account.currentBalance ?? 0;
  // Index-based x so the line always renders (dates can repeat within a day).
  const chartData = (data?.history ?? []).map((p, i) => ({
    i,
    balance: p.balance,
    label: new Date(p.date).toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
  }));
  const num = Number(amount);
  const canSubmit = num > 0 && !add.isPending;

  return (
    <div className="min-h-screen bg-gradient-to-b from-pink-100 via-violet-100 to-indigo-100 px-4 py-6">
      <div className="mx-auto max-w-md space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-3xl">🐷</span>
            <h1 className="text-xl font-extrabold text-violet-900">{user?.name}'s Piggy Bank</h1>
          </div>
          <button onClick={logout} className="text-xs font-medium text-violet-400 underline">
            Sign out
          </button>
        </div>

        {/* Balance */}
        <div className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-violet-100">
          <p className="text-sm font-medium text-violet-400">You have saved</p>
          <p className="mt-1 text-5xl font-extrabold text-violet-900">{formatMoney(balance)}</p>
          {cheer && <p className="mt-2 text-sm font-semibold text-green-600">{cheer}</p>}
        </div>

        {/* Growth chart */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-violet-100">
          <p className="mb-2 text-sm font-bold text-violet-700">How your savings grew 🌱</p>
          {chartData.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="piggyFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="i"
                  type="number"
                  domain={[0, Math.max(chartData.length - 1, 1)]}
                  allowDecimals={false}
                  interval="preserveStartEnd"
                  tickFormatter={(i: number) => chartData[i]?.label ?? ""}
                  tick={{ fontSize: 11, fill: "#a78bfa" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis tick={{ fontSize: 11, fill: "#a78bfa" }} axisLine={false} tickLine={false} width={44} />
                <Tooltip
                  formatter={(v: number) => formatMoney(v)}
                  labelFormatter={(i: number) => chartData[i]?.label ?? ""}
                  contentStyle={{ borderRadius: 12, border: "1px solid #ede9fe", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="#7c3aed"
                  strokeWidth={3}
                  fill="url(#piggyFill)"
                  isAnimationActive={false}
                  dot={{ r: 3, fill: "#7c3aed" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-8 text-center text-sm text-violet-400">
              Add some coins to watch your chart grow! ✨
            </p>
          )}
        </div>

        {/* Add / spend */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-violet-100">
          <p className="mb-3 text-sm font-bold text-violet-700">Add or spend money</p>
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-2xl bg-violet-50 px-4 py-3">
              <span className="text-xl font-bold text-violet-400">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent text-2xl font-bold text-violet-900 outline-none placeholder:text-violet-200"
              />
            </div>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What is it for? (e.g. Birthday gift)"
              className="w-full rounded-2xl border border-violet-100 bg-white px-4 py-3 text-sm text-violet-900 outline-none focus:border-violet-300"
            />
            {error && <p className="text-center text-sm font-medium text-red-500">{error}</p>}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => add.mutate("in")}
                disabled={!canSubmit}
                className="rounded-2xl bg-green-500 py-3 text-base font-bold text-white shadow-sm transition hover:bg-green-600 disabled:opacity-40"
              >
                💰 Add money
              </button>
              <button
                onClick={() => add.mutate("out")}
                disabled={!canSubmit}
                className="rounded-2xl bg-pink-500 py-3 text-base font-bold text-white shadow-sm transition hover:bg-pink-600 disabled:opacity-40"
              >
                🛍️ Spend
              </button>
            </div>
          </div>
        </div>

        {/* Activity */}
        <div className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-violet-100">
          <p className="mb-3 text-sm font-bold text-violet-700">Recent activity</p>
          {(!data || data.transactions.length === 0) && (
            <p className="py-4 text-center text-sm text-violet-400">Nothing yet — add your first coins! 🪙</p>
          )}
          <div className="space-y-1">
            {data?.transactions.map((t) => {
              const isIn = t.amount >= 0;
              return (
                <div key={t.id} className="flex items-center justify-between rounded-2xl px-2 py-2 hover:bg-violet-50">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{isIn ? "💰" : "🛍️"}</span>
                    <div>
                      <p className="text-sm font-semibold text-violet-900">{t.description ?? "Money"}</p>
                      <p className="text-xs text-violet-400">
                        {new Date(t.postedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${isIn ? "text-green-600" : "text-pink-600"}`}>
                      {isIn ? "+" : ""}
                      {formatMoney(t.amount)}
                    </span>
                    <button
                      onClick={() => remove.mutate(t.id)}
                      title="Undo"
                      className="text-violet-300 hover:text-violet-500"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
