import type { ReactNode } from "react";
import {
  ResourceDetailPage,
  ResourceDetailSection,
  ResourceMeta,
  ResourceOverflowMenu,
  ResourceProperty,
  ResourcePropertyList,
  ResourceStatus,
  type ResourceOverflowMenuItem,
  type ResourceStatusTone,
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

export interface PluginDetailHealth {
  label: ReactNode;
  tone: ResourceStatusTone;
}

export function PluginDetailView({
  leading,
  title,
  health,
  metadata,
  description,
  enabled,
  lifecycleDisabled = false,
  onEnabledChange,
  overflowItems,
  properties,
  sections = [],
}: {
  leading: ReactNode;
  title: string;
  health?: PluginDetailHealth;
  metadata: readonly ReactNode[];
  description?: ReactNode;
  enabled?: boolean;
  lifecycleDisabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  overflowItems?: readonly ResourceOverflowMenuItem[];
  properties: readonly PluginDetailProperty[];
  sections?: readonly PluginDetailSection[];
}) {
  const hasLifecycleControl =
    enabled !== undefined && onEnabledChange !== undefined;
  return (
    <ResourceDetailPage
      leading={leading}
      title={title}
      info={
        health ? (
          <ResourceStatus tone={health.tone}>{health.label}</ResourceStatus>
        ) : undefined
      }
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
        <ResourceDetailSection label="Configuration">
          <ResourcePropertyList>
            {properties.map((property, index) => (
              <ResourceProperty key={index} label={property.label}>
                {property.value}
              </ResourceProperty>
            ))}
          </ResourcePropertyList>
        </ResourceDetailSection>
      ) : null}
      {sections.map((section, index) => (
        <ResourceDetailSection key={index} label={section.label}>
          {section.content}
        </ResourceDetailSection>
      ))}
    </ResourceDetailPage>
  );
}
