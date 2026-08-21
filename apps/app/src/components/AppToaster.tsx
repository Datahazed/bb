import { Toaster, type ToasterProps } from "sonner";
import { experimental_useAppearance } from "@/lib/plugin-appearance";

export function AppToaster(props: ToasterProps) {
  const { colorMode } = experimental_useAppearance();
  return <Toaster theme={colorMode} {...props} />;
}
