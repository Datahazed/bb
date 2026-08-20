CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`expo_push_token` text NOT NULL,
	`platform` text NOT NULL,
	`device_label` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_expo_push_token_idx` ON `push_subscriptions` (`expo_push_token`);