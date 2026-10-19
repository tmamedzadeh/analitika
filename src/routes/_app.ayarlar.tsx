import { createFileRoute } from "@tanstack/react-router";
import { KeyRound, Plus, ShieldCheck, UserRound, UserX } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { ZirveLoader, ZirveSkeleton } from "@/components/ZirveLoader";
import { Button } from "@/components/ui/button";
import { Shell } from "@/components/Shell";
import {
  changeOwnPassword,
  createManagedUser,
  getSettingsIdentity,
  listManagedUsers,
  resetManagedUserPassword,
  updateManagedUserActive,
  updateManagedUserClearance,
} from "@/lib/auth.functions";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/_app/ayarlar")({
  head: () => ({
    meta: [
      { title: "Ayarlar · İstifadəçilər" },
      {
        name: "description",
        content: "İstifadəçi hesablarını və məxfilik səviyyələrini idarə edin.",
      },
      { property: "og:title", content: "Ayarlar · İstifadəçilər" },
      {
        property: "og:description",
        content: "İstifadəçi hesablarını və məxfilik səviyyələrini idarə edin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

const clearanceValues = ["open", "secret", "top_secret", "special"] as const;
type Clearance = (typeof clearanceValues)[number];
type ManagedUser = Awaited<ReturnType<typeof listManagedUsers>>[number];

function Settings() {
  const [identity, setIdentity] = useState<Awaited<ReturnType<typeof getSettingsIdentity>> | null>(
    null,
  );
  const [identityLoading, setIdentityLoading] = useState(true);
  const [identityError, setIdentityError] = useState("");
  const isAdmin = identity?.role === "admin";
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(isAdmin);
  const [usersError, setUsersError] = useState("");
  const [username, setUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordConfirmation, setNewPasswordConfirmation] = useState("");
  const [newClearance, setNewClearance] = useState<Clearance>("open");
  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createError, setCreateError] = useState("");
  const [ownCurrentPassword, setOwnCurrentPassword] = useState("");
  const [ownNewPassword, setOwnNewPassword] = useState("");
  const [ownConfirmation, setOwnConfirmation] = useState("");
  const [changingOwnPassword, setChangingOwnPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [userMessage, setUserMessage] = useState("");
  const [userError, setUserError] = useState("");

  useEffect(() => {
    let mounted = true;
    getSettingsIdentity()
      .then((value) => {
        if (mounted) setIdentity(value);
      })
      .catch(() => {
        if (mounted) setIdentityError(az.userManagement.actionFailed);
      })
      .finally(() => {
        if (mounted) setIdentityLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isAdmin) return;
    setUsersLoading(true);
    setUsersError("");
    try {
      setUsers(await listManagedUsers());
    } catch {
      setUsersError(az.userManagement.usersLoadFailed);
    } finally {
      setUsersLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setCreateMessage("");
    setCreateError("");
    if (newPassword !== newPasswordConfirmation) {
      setCreateError(az.userManagement.passwordMismatch);
      setCreating(false);
      return;
    }
    try {
      await createManagedUser({
        data: {
          username,
          password: newPassword,
          confirmation: newPasswordConfirmation,
          clearance: newClearance,
        },
      });
      setUsername("");
      setNewPassword("");
      setNewPasswordConfirmation("");
      setNewClearance("open");
      setCreateMessage(az.userManagement.userCreated);
      await loadUsers();
    } catch (error) {
      setCreateError(
        error instanceof Error && error.message.includes("already exists")
          ? "Bu istifadəçi adı artıq mövcuddur."
          : az.userManagement.actionFailed,
      );
    } finally {
      setCreating(false);
    }
  }

  async function updateClearance(target: ManagedUser, clearance: Clearance) {
    setBusyUserId(target.id);
    setUserMessage("");
    setUserError("");
    try {
      await updateManagedUserClearance({ data: { userId: target.id, clearance } });
      setUserMessage(az.userManagement.clearanceSaved);
      await loadUsers();
    } catch {
      setUserError(az.userManagement.actionFailed);
    } finally {
      setBusyUserId("");
    }
  }

  async function updateActive(target: ManagedUser) {
    const nextActive = !target.active;
    const confirmText = nextActive
      ? az.userManagement.activateConfirm.replace("{username}", target.username)
      : az.userManagement.deactivateConfirm.replace("{username}", target.username);
    if (!window.confirm(confirmText)) return;
    setBusyUserId(target.id);
    setUserMessage("");
    setUserError("");
    try {
      await updateManagedUserActive({ data: { userId: target.id, active: nextActive } });
      setUserMessage(nextActive ? az.userManagement.activate : az.userManagement.deactivate);
      await loadUsers();
    } catch {
      setUserError(az.userManagement.actionFailed);
    } finally {
      setBusyUserId("");
    }
  }

  async function resetPassword(
    target: ManagedUser,
    password: string,
    confirmation: string,
    form: HTMLFormElement,
  ) {
    if (password !== confirmation) {
      setUserError(az.userManagement.passwordMismatch);
      return;
    }
    setBusyUserId(target.id);
    setUserMessage("");
    setUserError("");
    try {
      await resetManagedUserPassword({ data: { userId: target.id, password, confirmation } });
      form.reset();
      setUserMessage(az.userManagement.passwordReset);
    } catch {
      setUserError(az.userManagement.actionFailed);
    } finally {
      setBusyUserId("");
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changingOwnPassword) return;
    setPasswordMessage("");
    setPasswordError("");
    if (ownNewPassword !== ownConfirmation) {
      setPasswordError(az.userManagement.passwordMismatch);
      return;
    }
    setChangingOwnPassword(true);
    try {
      await changeOwnPassword({
        data: {
          currentPassword: ownCurrentPassword,
          password: ownNewPassword,
          confirmation: ownConfirmation,
        },
      });
      setOwnCurrentPassword("");
      setOwnNewPassword("");
      setOwnConfirmation("");
      setPasswordMessage(az.userManagement.passwordChanged);
    } catch (error) {
      setPasswordError(
        error instanceof Error && error.message.includes("Current password")
          ? az.userManagement.currentPasswordIncorrect
          : az.userManagement.actionFailed,
      );
    } finally {
      setChangingOwnPassword(false);
    }
  }

  return (
    <Shell crumb={az.navigation.settings} title={az.userManagement.title}>
      <div className="mx-auto grid min-w-0 max-w-6xl grid-cols-1 gap-6">
        {identityLoading && <ZirveSkeleton label={az.loader.loading} rows={3} />}
        {identityError && (
          <div
            className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            <p>{identityError}</p>
            <button
              type="button"
              className="mt-2 underline underline-offset-4"
              onClick={() => window.location.reload()}
            >
              {az.actions.retry}
            </button>
          </div>
        )}
        {isAdmin && (
          <section className="panel min-w-0 p-4 sm:p-6" aria-labelledby="managed-users-heading">
            <div className="mb-5 flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-primary">
                <ShieldCheck size={19} aria-hidden="true" />
              </span>
              <div>
                <h2 id="managed-users-heading" className="text-lg font-semibold">
                  {az.userManagement.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {az.userManagement.description}
                </p>
              </div>
            </div>

            <form
              onSubmit={(event) => void createUser(event)}
              className="mb-6 grid gap-4 rounded-2xl border border-border bg-secondary/35 p-4 md:grid-cols-2"
            >
              <label className="space-y-1.5 text-sm font-medium">
                <span>{az.userManagement.username}</span>
                <input
                  className="field"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="off"
                  maxLength={50}
                  required
                  disabled={creating}
                />
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>{az.userManagement.clearance}</span>
                <select
                  className="field"
                  value={newClearance}
                  onChange={(event) => setNewClearance(event.target.value as Clearance)}
                  disabled={creating}
                >
                  {clearanceValues.map((value) => (
                    <option key={value} value={value}>
                      {az.documents.classification[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>{az.userManagement.password}</span>
                <input
                  className="field"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  disabled={creating}
                />
                <span className="block text-xs font-normal text-muted-foreground">
                  {az.userManagement.passwordHelp}
                </span>
              </label>
              <label className="space-y-1.5 text-sm font-medium">
                <span>{az.userManagement.confirmPassword}</span>
                <input
                  className="field"
                  type="password"
                  value={newPasswordConfirmation}
                  onChange={(event) => setNewPasswordConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  disabled={creating}
                />
              </label>
              <div className="md:col-span-2">
                <Button type="submit" disabled={creating} aria-busy={creating}>
                  {creating ? (
                    <ZirveLoader variant="button" label={az.userManagement.creating} />
                  ) : (
                    <Plus size={16} aria-hidden="true" />
                  )}
                  {creating ? az.userManagement.creating : az.userManagement.createUser}
                </Button>
              </div>
              <div className="md:col-span-2" aria-live="polite">
                {createMessage && (
                  <p role="status" className="text-sm text-success">
                    {createMessage}
                  </p>
                )}
                {createError && (
                  <p role="alert" className="text-sm text-destructive">
                    {createError}
                  </p>
                )}
              </div>
            </form>

            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{az.userManagement.title}</h3>
              {users.length > 0 && (
                <span className="text-xs text-muted-foreground">{users.length}</span>
              )}
            </div>
            {usersLoading ? (
              <ZirveSkeleton label={az.loader.loading} rows={4} />
            ) : usersError ? (
              <div
                className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
                role="alert"
              >
                <p>{usersError}</p>
                <button
                  className="mt-2 underline underline-offset-4"
                  type="button"
                  onClick={() => void loadUsers()}
                >
                  {az.actions.retry}
                </button>
              </div>
            ) : users.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">
                {az.userManagement.noUsers}
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                  <thead className="bg-secondary/70 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">{az.userManagement.username}</th>
                      <th className="px-4 py-3 font-medium">{az.userManagement.role}</th>
                      <th className="px-4 py-3 font-medium">{az.userManagement.clearance}</th>
                      <th className="px-4 py-3 font-medium">{az.userManagement.status}</th>
                      <th className="px-4 py-3 font-medium">{az.userManagement.createdAt}</th>
                      <th className="px-4 py-3 font-medium">{az.userManagement.actions}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((managedUser) => (
                      <tr key={managedUser.id} className="align-top">
                        <td className="px-4 py-4 font-semibold">{managedUser.username}</td>
                        <td className="px-4 py-4">
                          {managedUser.role === "admin"
                            ? az.userManagement.admin
                            : az.userManagement.user}
                        </td>
                        <td className="px-4 py-4">
                          <select
                            className="field min-w-36 py-2"
                            value={managedUser.clearance}
                            onChange={(event) =>
                              void updateClearance(managedUser, event.target.value as Clearance)
                            }
                            disabled={
                              busyUserId === managedUser.id || managedUser.id === identity?.id
                            }
                            aria-label={`${az.userManagement.clearance}: ${managedUser.username}`}
                          >
                            {clearanceValues.map((value) => (
                              <option key={value} value={value}>
                                {az.documents.classification[value]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-4">
                          <span className={managedUser.active ? "pill pill-active" : "pill"}>
                            {managedUser.active
                              ? az.userManagement.active
                              : az.userManagement.inactive}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-muted-foreground">
                          {new Intl.DateTimeFormat("az-AZ", { dateStyle: "medium" }).format(
                            new Date(managedUser.createdAt),
                          )}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-start gap-2">
                            <button
                              type="button"
                              disabled={
                                busyUserId === managedUser.id || managedUser.id === identity?.id
                              }
                              onClick={() => void updateActive(managedUser)}
                              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
                            >
                              {managedUser.active ? (
                                <UserX size={14} aria-hidden="true" />
                              ) : (
                                <UserRound size={14} aria-hidden="true" />
                              )}
                              {managedUser.active
                                ? az.userManagement.deactivate
                                : az.userManagement.activate}
                            </button>
                            <details className="group">
                              <summary className="cursor-pointer list-none text-xs font-medium text-primary hover:underline">
                                <span className="inline-flex items-center gap-1.5">
                                  <KeyRound size={14} aria-hidden="true" />
                                  {az.userManagement.resetPassword}
                                </span>
                              </summary>
                              <form
                                className="mt-3 grid min-w-64 gap-2 rounded-lg border border-border bg-card p-3"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  const form = event.currentTarget;
                                  const values = new FormData(form);
                                  void resetPassword(
                                    managedUser,
                                    String(values.get("password") ?? ""),
                                    String(values.get("confirmation") ?? ""),
                                    form,
                                  );
                                }}
                              >
                                <input
                                  className="field"
                                  name="password"
                                  type="password"
                                  autoComplete="new-password"
                                  minLength={12}
                                  maxLength={256}
                                  placeholder={az.userManagement.newPassword}
                                  required
                                />
                                <input
                                  className="field"
                                  name="confirmation"
                                  type="password"
                                  autoComplete="new-password"
                                  minLength={12}
                                  maxLength={256}
                                  placeholder={az.userManagement.confirmPassword}
                                  required
                                />
                                <Button
                                  type="submit"
                                  size="sm"
                                  disabled={busyUserId === managedUser.id}
                                >
                                  {busyUserId === managedUser.id
                                    ? az.userManagement.resettingPassword
                                    : az.userManagement.resetPassword}
                                </Button>
                              </form>
                            </details>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="mt-3 min-h-5" aria-live="polite">
              {userMessage && (
                <p role="status" className="text-sm text-success">
                  {userMessage}
                </p>
              )}
              {userError && (
                <p role="alert" className="text-sm text-destructive">
                  {userError}
                </p>
              )}
            </div>
          </section>
        )}

        <section
          className="panel min-w-0 max-w-3xl p-4 sm:p-6"
          aria-labelledby="own-password-heading"
        >
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary">
              <KeyRound size={18} aria-hidden="true" />
            </span>
            <div>
              <h2 id="own-password-heading" className="font-semibold">
                {az.userManagement.ownPassword}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">{identity?.username}</p>
            </div>
          </div>
          <form
            onSubmit={(event) => void changePassword(event)}
            className="grid gap-4 sm:grid-cols-2"
          >
            <label className="space-y-1.5 text-sm font-medium sm:col-span-2">
              <span>{az.userManagement.currentPassword}</span>
              <input
                className="field"
                type="password"
                value={ownCurrentPassword}
                onChange={(event) => setOwnCurrentPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={256}
                required
                disabled={changingOwnPassword}
              />
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{az.userManagement.newPassword}</span>
              <input
                className="field"
                type="password"
                value={ownNewPassword}
                onChange={(event) => setOwnNewPassword(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={changingOwnPassword}
              />
              <span className="block text-xs font-normal text-muted-foreground">
                {az.userManagement.passwordHelp}
              </span>
            </label>
            <label className="space-y-1.5 text-sm font-medium">
              <span>{az.userManagement.confirmPassword}</span>
              <input
                className="field"
                type="password"
                value={ownConfirmation}
                onChange={(event) => setOwnConfirmation(event.target.value)}
                autoComplete="new-password"
                minLength={12}
                maxLength={256}
                required
                disabled={changingOwnPassword}
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={changingOwnPassword} aria-busy={changingOwnPassword}>
                {changingOwnPassword ? (
                  <ZirveLoader variant="button" label={az.userManagement.changingPassword} />
                ) : (
                  <KeyRound size={16} aria-hidden="true" />
                )}
                {changingOwnPassword
                  ? az.userManagement.changingPassword
                  : az.userManagement.changePassword}
              </Button>
            </div>
            <div className="sm:col-span-2" aria-live="polite">
              {passwordMessage && (
                <p role="status" className="text-sm text-success">
                  {passwordMessage}
                </p>
              )}
              {passwordError && (
                <p role="alert" className="text-sm text-destructive">
                  {passwordError}
                </p>
              )}
            </div>
          </form>
        </section>
      </div>
    </Shell>
  );
}
