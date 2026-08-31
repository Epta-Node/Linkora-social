import { useCallback, useEffect, useMemo, useState } from "react";
import { secureStorage } from "../utils/secureStorage";
import type { MiniApp } from "../components/MiniAppIcon";

const INSTALLED_KEY = "mini_apps_installed";

const DEFAULT_APPS: MiniApp[] = [
  {
    id: "tip-jar",
    name: "Tip Jar",
    description: "Tip any Linkora post with XLM using your connected wallet.",
    icon: "",
    entry: "https://linkora-social.github.io/mini-apps/tip-jar/index.html",
    permissions: ["wallet.getAddress", "wallet.signTransaction"],
  },
  {
    id: "poll-maker",
    name: "Poll Maker",
    description: "Create and vote on polls in your community.",
    icon: "",
    entry: "https://linkora-social.github.io/mini-apps/poll-maker/index.html",
    permissions: ["wallet.getAddress"],
  },
];

const AVAILABLE_APPS: MiniApp[] = [
  ...DEFAULT_APPS,
  {
    id: "mini-gallery",
    name: "Mini Gallery",
    description: "Showcase your NFT collection in a beautiful grid.",
    icon: "",
    entry: "https://linkora-social.github.io/mini-apps/mini-gallery/index.html",
    permissions: ["wallet.getAddress"],
  },
  {
    id: "event-brite",
    name: "Event Brite",
    description: "Discover and RSVP to community events.",
    icon: "",
    entry: "https://linkora-social.github.io/mini-apps/event-brite/index.html",
    permissions: ["wallet.getAddress", "wallet.signTransaction"],
  },
];

export function useInstalledApps() {
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await secureStorage.get<MiniApp[]>(INSTALLED_KEY);
      setApps(stored ?? DEFAULT_APPS);
      setLoaded(true);
    })();
  }, []);

  const install = useCallback(async (app: MiniApp) => {
    const next = await secureStorage.get<MiniApp[]>(INSTALLED_KEY);
    const current = next ?? DEFAULT_APPS;
    if (current.some((a) => a.id === app.id)) return;
    const updated = [...current, app];
    await secureStorage.set(INSTALLED_KEY, updated);
    setApps(updated);
  }, []);

  const uninstall = useCallback(async (appId: string) => {
    const next = await secureStorage.get<MiniApp[]>(INSTALLED_KEY);
    const current = next ?? DEFAULT_APPS;
    const updated = current.filter((a) => a.id !== appId);
    await secureStorage.set(INSTALLED_KEY, updated);
    setApps(updated);
  }, []);

  const isInstalled = useCallback(
    (appId: string) => apps.some((a) => a.id === appId),
    [apps],
  );

  const discoverable = useMemo(
    () => AVAILABLE_APPS.filter((app) => !isInstalled(app.id)),
    [isInstalled],
  );

  return { apps, loaded, install, uninstall, isInstalled, discoverable };
}
