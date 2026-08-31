ALTER TABLE `plugins` ADD `handler_error_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_problem_class` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_problem_message` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_problem_at` integer;