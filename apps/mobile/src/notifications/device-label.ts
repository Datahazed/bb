import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Human-readable device name for the server's subscription list (the
 * dashboard-style "Sawyer's iPhone"). Never includes anything sensitive.
 */
export function describeThisDevice(): string {
  const name = Constants.deviceName?.trim();
  if (name && name.length > 0) return name.slice(0, 128);
  return Platform.OS === "android" ? "Android device" : "iPhone";
}
