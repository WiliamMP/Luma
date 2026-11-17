import { supabase } from "./lib";
import { mutedStore, statusStore } from "./unread";
import { volumesStore } from "./voice";

/** settings that follow the account: kept in localStorage for a fast start, and in the `settings` table */
const synced = { muted: mutedStore, status: statusStore, volumes: volumesStore } as const;
type Key = keyof typeof synced;

/**
 * After login: the saved settings replace this device's; from then on every change is saved
 * (1 s after the last one). Returns the cleanup.
 */
export function syncSettings(me: string) {
  let loaded = false;
  let timer = 0;
  const save = () =>
    supabase
      .from("settings")
      .upsert({
        user_id: me,
        data: Object.fromEntries(Object.entries(synced).map(([k, s]) => [k, s.get()])),
        updated_at: new Date().toISOString(),
      })
      .then(({ error }) => error && console.error(error));

  supabase
    .from("settings")
    .select("data")
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) return console.error(error); // table missing / offline: stay with this device's settings
      const saved = (data?.data ?? {}) as Partial<Record<Key, unknown>>;
      for (const key of Object.keys(synced) as Key[]) {
        // ponytail: trusts the stored shape; validate per key if other clients ever write this table
        if (key in saved) (synced[key].set as (v: unknown) => void)(saved[key]);
      }
      loaded = true;
      if (!data) save(); // first login with this feature: upload what this device has
    });

  const offs = Object.values(synced).map((s) =>
    s.subscribe(() => {
      if (!loaded) return; // values arriving from the server must not echo back
      clearTimeout(timer);
      timer = window.setTimeout(save, 1000);
    }),
  );
  return () => {
    clearTimeout(timer);
    offs.forEach((off) => off());
  };
}
