import {
  createPushRegistrationController,
  type PushRegistrationController,
} from "@/data/notifications";
import { describeThisDevice } from "./device-label";
import { getPushNotificationsModule } from "./expo-push-module";
import { getPushStore, getPushSubscriptionsApi } from "./push-storage";

let instance: PushRegistrationController | null = null;

/** App-wide registration controller over expo-notifications + MMKV + fetch. */
export function getPushRegistrationController(): PushRegistrationController {
  instance ??= createPushRegistrationController({
    notifications: getPushNotificationsModule(),
    api: getPushSubscriptionsApi(),
    store: getPushStore(),
    deviceLabel: describeThisDevice(),
  });
  return instance;
}
