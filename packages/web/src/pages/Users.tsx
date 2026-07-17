import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ROLES, type Role } from "@panditas/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";

interface FamilyUser {
  id: string;
  name: string;
  role: Role;
  email: string | null;
  avatarEmoji: string | null;
  isActive: boolean;
}

const ROLE_LABELS: Record<Role, string> = { admin: "Admin", adult: "Adult", kid: "Kid" };

export function UsersPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ name: "", role: "adult" as Role, email: "", password: "", pin: "", avatarEmoji: "" });
  const [error, setError] = useState<string | null>(null);

  const users = useQuery({ queryKey: ["users"], queryFn: () => api.get<FamilyUser[]>("/users") });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => {
      const isKid = form.role === "kid";
      return api.post("/users", {
        name: form.name,
        role: form.role,
        email: isKid ? undefined : form.email,
        password: isKid ? undefined : form.password,
        pin: isKid ? form.pin : undefined,
        avatarEmoji: form.avatarEmoji || undefined,
      });
    },
    onSuccess: () => {
      setForm({ name: "", role: "adult", email: "", password: "", pin: "", avatarEmoji: "" });
      setError(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create user"),
  });

  const setActive = useMutation({
    mutationFn: (v: { id: string; isActive: boolean }) => api.patch(`/users/${v.id}`, { isActive: v.isActive }),
    onSuccess: invalidate,
  });

  const setName = useMutation({
    mutationFn: (v: { id: string; name: string }) => api.patch(`/users/${v.id}`, { name: v.name }),
    onSuccess: invalidate,
  });

  if (user?.role !== "admin") {
    return <p className="text-slate-600">Only an admin can manage users.</p>;
  }

  const isKid = form.role === "kid";
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate();
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <p className="text-sm text-slate-600">Add family members and assign roles. Assign account ownership in Settings.</p>
      </div>

      <section className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Add a user</h2>
        <form onSubmit={onSubmit} className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="input" />
          </Field>
          <Field label="Role">
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="input">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </Field>

          {isKid ? (
            <Field label="PIN (4–8 digits)">
              <input required value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} inputMode="numeric" className="input" />
            </Field>
          ) : (
            <>
              <Field label="Email">
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="input" />
              </Field>
              <Field label="Password (min 8)">
                <input required type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="input" />
              </Field>
            </>
          )}

          <Field label="Avatar emoji (optional)">
            <input value={form.avatarEmoji} onChange={(e) => setForm({ ...form, avatarEmoji: e.target.value })} placeholder="🦄" className="input" />
          </Field>

          <div className="flex items-end sm:col-span-2">
            {error && <p className="mr-4 text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={create.isPending} className="ml-auto rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {create.isPending ? "Adding…" : "Add user"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Family members</h2>
        <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
          {users.data?.map((u) => (
            <UserRow
              key={u.id}
              user={u}
              isSelf={u.id === user.id}
              onName={(name) => setName.mutate({ id: u.id, name })}
              onActive={(isActive) => setActive.mutate({ id: u.id, isActive })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function UserRow({
  user,
  isSelf,
  onName,
  onActive,
}: {
  user: FamilyUser;
  isSelf: boolean;
  onName: (name: string) => void;
  onActive: (isActive: boolean) => void;
}) {
  const [name, setNameValue] = useState(user.name);
  const commit = () => {
    const next = name.trim();
    if (next && next !== user.name) onName(next);
    else setNameValue(user.name);
  };

  return (
    <div className={`flex items-center justify-between gap-3 border-b border-slate-100 bg-white p-3 text-sm last:border-0 ${user.isActive ? "" : "opacity-60"}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-xl">{user.avatarEmoji ?? "👤"}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              className="max-w-[10rem] rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-900"
            />
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">{ROLE_LABELS[user.role]}</span>
            {isSelf && <span className="text-xs text-slate-500">you</span>}
          </div>
          <p className="mt-1 text-xs text-slate-500">{user.email ?? "PIN login"}</p>
        </div>
      </div>
      {!isSelf && (
        <button
          onClick={() => onActive(!user.isActive)}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
        >
          {user.isActive ? "Deactivate" : "Reactivate"}
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm font-medium text-slate-700">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  );
}
