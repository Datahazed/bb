CREATE TABLE IF NOT EXISTS `agent_instruction_snapshots` (
	`content_hash` text PRIMARY KEY NOT NULL,
	`instructions` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `thread_agent_instructions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`content_hash`) REFERENCES `agent_instruction_snapshots`(`content_hash`) ON UPDATE no action ON DELETE no action
);
