DROP TABLE `environment_operations`;--> statement-breakpoint
DROP TABLE `project_operations`;--> statement-breakpoint
DROP TABLE `thread_operations`;--> statement-breakpoint
DROP INDEX `client_turn_requests_command_idx`;--> statement-breakpoint
ALTER TABLE `client_turn_requests` DROP COLUMN `command_id`;--> statement-breakpoint
ALTER TABLE `client_turn_requests` DROP COLUMN `command_type`;--> statement-breakpoint
ALTER TABLE `client_turn_requests` DROP COLUMN `command_completed_at`;--> statement-breakpoint
ALTER TABLE `projects` ADD `delete_requested_at` integer;