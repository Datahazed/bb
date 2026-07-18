CREATE TABLE `collaborators` (
	`handle` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`image_url` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `events` ADD `actor_handle` text;--> statement-breakpoint
ALTER TABLE `pending_interactions` ADD `resolved_by_handle` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `actor_handle` text;--> statement-breakpoint
ALTER TABLE `threads` ADD `created_by_handle` text;