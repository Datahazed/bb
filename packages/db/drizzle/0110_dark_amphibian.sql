CREATE TABLE `plugin_listing_lifecycles` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`lifecycle_json` text NOT NULL,
	`notice_kind` text DEFAULT 'none' NOT NULL,
	`notice_id` text DEFAULT '' NOT NULL,
	`notice_json` text DEFAULT '{"kind":"none"}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
