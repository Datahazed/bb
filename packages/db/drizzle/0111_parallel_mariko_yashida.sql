CREATE TABLE `thread_timeline_checkpoints` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`checkpoint_key` text NOT NULL,
	`sequence` integer NOT NULL,
	`event_id` text NOT NULL,
	`event_count` integer NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
