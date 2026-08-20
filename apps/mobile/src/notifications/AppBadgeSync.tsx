import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { badgeCountFromSidebar } from "@/data/notifications";
import { useSidebarBootstrap } from "@/data/sidebar";
import { getPushNotificationsModule } from "./expo-push-module";

/**
 * App-icon badge = unread / pending threads on the active server. Written
 * when the app goes to the background (what the user will see on the home
 * screen) and cleared while the app is active on the thread list (the user
 * has seen it) — including the moment the app foregrounds onto it. Requires
 * an active connection (the sidebar query).
 */
export function AppBadgeSync({ pathname }: { pathname: string }) {
  const { data } = useSidebarBootstrap();
  const count = data ? badgeCountFromSidebar(data) : null;
  const countRef = useRef(count);
  useEffect(() => {
    countRef.current = count;
  }, [count]);
  const notifications = getPushNotificationsModule();
  const onHome = pathname === "/" || pathname === "";
  const [appState, setAppState] = useState<AppStateStatus>(
    AppState.currentState,
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      setAppState(state);
      if (state === "background" && countRef.current !== null) {
        void notifications
          .setBadgeCount(countRef.current)
          .catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, [notifications]);

  useEffect(() => {
    if (onHome && appState === "active") {
      void notifications.setBadgeCount(0).catch(() => undefined);
    }
  }, [onHome, appState, notifications, count]);

  return null;
}
