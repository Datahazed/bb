CREATE TABLE `thread_timeline_projections` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`projection_key` text NOT NULL,
	`payload_json` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
