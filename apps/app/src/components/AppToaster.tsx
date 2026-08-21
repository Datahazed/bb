import { Toaster, type ToasterProps } from "sonner";
import { usePluginAppearance } from "@/lib/plugin-appearance";

export function AppToaster(props: ToasterProps) {
  const { colorMode } = usePluginAppearance();
  return <Toaster theme={colorMode} {...props} />;
}
