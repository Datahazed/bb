import type { ReactNode } from "react";
import {
  ResourceActivitySection,
  ResourceDefinitionSection,
  ResourceDetailPage,
  ResourceMeta,
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
  back,
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
  back?: ReactNode;
  leading: ReactNode;
  title: string;
  titleMeta?: ReactNode;
  metadata: readonly ReactNode[];
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
  return (
    <ResourceDetailPage
      back={back}
      leading={leading}
      title={title}
      titleMeta={titleMeta}
      metadata={<ResourceMeta items={metadata} />}
      description={description}
      lifecycleControl={
        hasLifecycleControl ? (
          <Switch
            size="sm"
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
      {properties.length > 0 ? (
        <ResourceDefinitionSection label="Configuration">
          <ResourcePropertyList>
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
    </ResourceDetailPage>
  );
}
