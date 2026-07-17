import type { ReactNode } from "react";
import {
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceDetailStack,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Switch } from "@bb/shared-ui/switch";

export interface PluginDetailProperty {
  label: ReactNode;
  value: ReactNode;
}

export interface PluginDetailSection {
  label: ReactNode;
  content: ReactNode;
}

export function PluginDetailView({
  leading,
  title,
  titleMeta,
  metadata,
  description,
  enabled,
  lifecycleDisabled = false,
  onEnabledChange,
  overflowItems,
  properties = [],
  definitionSections = [],
  activitySections = [],
}: {
  leading: ReactNode;
  title: string;
  titleMeta?: ReactNode;
  metadata: ReactNode;
  description?: ReactNode;
  enabled?: boolean;
  lifecycleDisabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  overflowItems?: readonly ResourceOverflowMenuItem[];
  properties?: readonly PluginDetailProperty[];
  definitionSections?: readonly PluginDetailSection[];
  activitySections?: readonly PluginDetailSection[];
}) {
  const hasLifecycleControl =
    enabled !== undefined && onEnabledChange !== undefined;
  const hasDescription =
    description !== undefined &&
    description !== null &&
    description !== false &&
    description !== "";
  return (
    <ResourceDetailPage
      leading={leading}
      title={title}
      titleMeta={titleMeta}
      metadata={metadata}
      lifecycleControl={
        hasLifecycleControl ? (
          <Switch
            checked={enabled}
            disabled={lifecycleDisabled}
            aria-label={`${enabled ? "Disable" : "Enable"} ${title}`}
            onCheckedChange={onEnabledChange}
          />
        ) : undefined
      }
      overflowMenu={
        overflowItems && overflowItems.length > 0 ? (
          <ResourceOverflowMenu
            label={`${title} actions`}
            items={overflowItems}
          />
        ) : undefined
      }
    >
      {hasDescription ||
      properties.length > 0 ||
      definitionSections.length > 0 ||
      activitySections.length > 0 ? (
        <ResourceDetailStack>
          {hasDescription ? (
            <ResourceDefinitionSection label="About">
              <p className="text-sm leading-relaxed text-foreground">
                {description}
              </p>
            </ResourceDefinitionSection>
          ) : null}
          {properties.length > 0 ? (
            <ResourceDefinitionSection label="Configuration">
              <ResourcePropertyList
                surface="recessed"
                className="divide-y divide-border"
              >
                {properties.map((property, index) => (
                  <ResourceProperty key={index} label={property.label}>
                    {property.value}
                  </ResourceProperty>
                ))}
              </ResourcePropertyList>
            </ResourceDefinitionSection>
          ) : null}
          {definitionSections.map((section, index) => (
            <ResourceDefinitionSection key={index} label={section.label}>
              {section.content}
            </ResourceDefinitionSection>
          ))}
          {activitySections.map((section, index) => (
            <ResourceActivitySection key={index} label={section.label}>
              {section.content}
            </ResourceActivitySection>
          ))}
        </ResourceDetailStack>
      ) : null}
    </ResourceDetailPage>
  );
}
