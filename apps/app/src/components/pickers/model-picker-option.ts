import type { AvailableModel } from "@bb/domain";
import type { PickerOption } from "./OptionPicker";

/**
 * A model row in the picker. `qualifier` is short inline text, rendered after
 * the label and in its tooltip, that tells apart rows whose labels collide: a
 * Pi model's nested route provider, or (for any provider) the agent's short
 * description or raw model id when two models share a display name.
 */
export interface ModelPickerOption extends PickerOption<string> {
  qualifier?: string;
}

// Longer descriptions are marketing copy, not an identifier; the raw model id
// is the shorter and more useful disambiguator then.
const MAX_DESCRIPTION_QUALIFIER_LENGTH = 40;

function collidingModelQualifier(model: AvailableModel): string {
  const description = model.description.trim();
  return description.length > 0 &&
    description.length <= MAX_DESCRIPTION_QUALIFIER_LENGTH
    ? description
    : model.model;
}

/**
 * Maps a provider's model catalog to picker rows. Only rows whose formatted
 * label is shared with another row in the same list get a qualifier (unless
 * the model already carries a route provider), so a catalog of unique names
 * renders exactly as before.
 */
export function toModelPickerOptions(
  models: readonly AvailableModel[],
  formatLabel: (displayName: string) => string,
): ModelPickerOption[] {
  const labeled = models.map((model) => ({
    model,
    label: formatLabel(model.displayName || model.model),
  }));
  const labelCounts = new Map<string, number>();
  for (const { label } of labeled) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  return labeled.map(({ model, label }): ModelPickerOption => {
    const qualifier =
      model.routeProviderId ??
      ((labelCounts.get(label) ?? 0) > 1
        ? collidingModelQualifier(model)
        : undefined);
    return {
      value: model.model,
      label,
      ...(qualifier ? { qualifier } : {}),
    };
  });
}
