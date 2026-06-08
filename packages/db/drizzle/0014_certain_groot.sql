DROP INDEX `pending_interactions_resolving_command_idx`;--> statement-breakpoint
ALTER TABLE `pending_interactions` DROP COLUMN `resolving_command_id`;--> statement-breakpoint
DROP INDEX `terminal_sessions_daemon_session_idx`;--> statement-breakpoint
ALTER TABLE `terminal_sessions` DROP COLUMN `daemon_session_id`;