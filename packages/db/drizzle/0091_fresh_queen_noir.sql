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
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `thread_agent_instructions_cleanup_snapshot`
AFTER DELETE ON `thread_agent_instructions`
BEGIN
	DELETE FROM `agent_instruction_snapshots`
	WHERE `content_hash` = OLD.`content_hash`
		AND NOT EXISTS (
			SELECT 1
			FROM `thread_agent_instructions`
			WHERE `content_hash` = OLD.`content_hash`
		);
END;
