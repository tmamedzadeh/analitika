import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Shell } from "@/components/Shell";

export const Route = createFileRoute("/ayarlar")({
  head: () => ({
    meta: [
      { title: "Ayarlar · İstifadəçilər" },
      {
        name: "description",
        content: "İstifadəçiləri və onların buraxılış səviyyələrini idarə edin.",
      },
      { property: "og:title", content: "Ayarlar · İstifadəçilər" },
      {
        property: "og:description",
        content: "İstifadəçiləri və onların buraxılış səviyyələrini idarə edin.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

const levels = ["Məxfi", "Tam məxfi", "Xüsusi əhəmiyyətli"] as const;

function Settings() {
  const [users, setUsers] = useState([{ name: "İstifadəçi 1", level: "Məxfi" as string }]);
  return (
    <Shell crumb="Ayarlar" title="İstifadəçilər" badges={["Sistem aktivdir"]}>
      <div className="panel max-w-3xl p-4 md:p-6">
        <p className="label-mono mb-3">Buraxılış səviyyəsi</p>
        <ul className="divide-y divide-border">
          {users.map((u, i) => (
            <li
              key={i}
              className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/40 font-semibold text-primary">
                  {i + 1}
                </span>
                <span className="font-semibold">{u.name}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {levels.map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() =>
                      setUsers(users.map((x, j) => (j === i ? { ...x, level: l } : x)))
                    }
                    className={u.level === l ? "pill pill-active" : "pill"}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() =>
            setUsers([...users, { name: `İstifadəçi ${users.length + 1}`, level: "Məxfi" }])
          }
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary/40 py-3 font-semibold text-primary"
        >
          <UserPlus size={18} /> İstifadəçi əlavə et
        </button>
      </div>
    </Shell>
  );
}
