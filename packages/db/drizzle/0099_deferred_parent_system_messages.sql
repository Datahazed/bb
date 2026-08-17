CREATE TABLE `deferred_parent_system_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_thread_id` text NOT NULL,
	`input` text NOT NULL,
	`system_message_kind` text NOT NULL,
	`system_message_subject` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deferred_parent_system_messages_parent_created_idx` ON `deferred_parent_system_messages` (`parent_thread_id`,`created_at`,`id`);