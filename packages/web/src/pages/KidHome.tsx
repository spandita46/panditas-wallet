import { useQuery } from "@tanstack/react-query";
import { formatMoney, type AccountDTO } from "@panditas/shared";
import { api } from "../api";
import { useAuth } from "../auth";

// Phase 4 will make this delightful. For now: a friendly balance view.
export function KidHomePage() {
  const { user, refresh } = useAuth();
  const { data } = useQuery({
    queryKey: ["kid-accounts"],
    queryFn: () => api.get<AccountDTO[]>("/accounts"),
  });

  const piggy = data?.find((a) => a.type === "piggy_bank");

  async function logout() {
    await api.post("/auth/logout");
    refresh();
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-b from-pink-50 to-violet-100 p-6 text-center">
      <div>
        <div className="text-6xl">🐷</div>
        <h1 className="mt-3 text-2xl font-bold text-violet-900">Hi {user?.name}!</h1>
        <p className="mt-1 text-violet-500">Your piggy bank has</p>
        <p className="mt-2 text-5xl font-extrabold text-violet-900">
          {piggy ? formatMoney(piggy.currentBalance) : "…"}
        </p>
        <button onClick={logout} className="mt-8 text-sm text-violet-400 underline">
          Sign out
        </button>
      </div>
    </div>
  );
}
