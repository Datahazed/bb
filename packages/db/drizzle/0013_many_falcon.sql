PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_environment_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`environment_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`command_id` text,
	`requested_at` integer NOT NULL,
	`queued_at` integer,
	`completed_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_environment_operations`("id", "environment_id", "kind", "state", "payload", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at") SELECT "id", "environment_id", "kind", "state", "payload", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at" FROM `environment_operations`;--> statement-breakpoint
DROP TABLE `environment_operations`;--> statement-breakpoint
ALTER TABLE `__new_environment_operations` RENAME TO `environment_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `environment_operations_environment_kind_idx` ON `environment_operations` (`environment_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `environment_operations_command_idx` ON `environment_operations` (`command_id`);--> statement-breakpoint
CREATE INDEX `environment_operations_state_idx` ON `environment_operations` (`state`);--> statement-breakpoint
CREATE INDEX `environment_operations_environment_idx` ON `environment_operations` (`environment_id`);--> statement-breakpoint
CREATE TABLE `__new_environments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`host_id` text NOT NULL,
	`path` text,
	`managed` integer DEFAULT false NOT NULL,
	`is_git_repo` integer DEFAULT false NOT NULL,
	`is_worktree` integer DEFAULT false NOT NULL,
	`branch_name` text,
	`base_branch` text,
	`default_branch` text,
	`merge_base_branch` text,
	`cleanup_requested_at` integer,
	`cleanup_mode` text,
	`workspace_provision_type` text NOT NULL,
	`status` text DEFAULT 'provisioning' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_environments`("id", "project_id", "host_id", "path", "managed", "is_git_repo", "is_worktree", "branch_name", "base_branch", "default_branch", "merge_base_branch", "cleanup_requested_at", "cleanup_mode", "workspace_provision_type", "status", "created_at", "updated_at") SELECT "id", "project_id", "host_id", "path", "managed", "is_git_repo", "is_worktree", "branch_name", "base_branch", "default_branch", "merge_base_branch", "cleanup_requested_at", "cleanup_mode", "workspace_provision_type", "status", "created_at", "updated_at" FROM `environments`;--> statement-breakpoint
DROP TABLE `environments`;--> statement-breakpoint
ALTER TABLE `__new_environments` RENAME TO `environments`;--> statement-breakpoint
CREATE UNIQUE INDEX `environments_host_path_idx` ON `environments` (`host_id`,`path`);--> statement-breakpoint
CREATE INDEX `environments_project_idx` ON `environments` (`project_id`);--> statement-breakpoint
CREATE INDEX `environments_cleanup_requested_idx` ON `environments` (`cleanup_requested_at`);--> statement-breakpoint
CREATE INDEX `environments_status_idx` ON `environments` (`status`);--> statement-breakpoint
CREATE TABLE `__new_pending_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_thread_id` text NOT NULL,
	`provider_request_id` text NOT NULL,
	`session_id` text NOT NULL,
	`resolving_command_id` text,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`resolution` text,
	`status_reason` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pending_interactions`("id", "thread_id", "turn_id", "provider_id", "provider_thread_id", "provider_request_id", "session_id", "resolving_command_id", "status", "payload", "resolution", "status_reason", "created_at", "resolved_at", "updated_at") SELECT "id", "thread_id", "turn_id", "provider_id", "provider_thread_id", "provider_request_id", "session_id", "resolving_command_id", "status", "payload", "resolution", "status_reason", "created_at", "resolved_at", "updated_at" FROM `pending_interactions`;--> statement-breakpoint
DROP TABLE `pending_interactions`;--> statement-breakpoint
ALTER TABLE `__new_pending_interactions` RENAME TO `pending_interactions`;--> statement-breakpoint
CREATE UNIQUE INDEX `pending_interactions_provider_request_idx` ON `pending_interactions` (`provider_id`,`provider_thread_id`,`provider_request_id`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_created_idx` ON `pending_interactions` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_status_created_idx` ON `pending_interactions` (`thread_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_status_created_idx` ON `pending_interactions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_resolving_command_idx` ON `pending_interactions` (`resolving_command_id`);--> statement-breakpoint
CREATE TABLE `__new_project_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`command_id` text,
	`requested_at` integer NOT NULL,
	`queued_at` integer,
	`completed_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_project_operations`("id", "project_id", "kind", "state", "payload", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at") SELECT "id", "project_id", "kind", "state", "payload", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at" FROM `project_operations`;--> statement-breakpoint
DROP TABLE `project_operations`;--> statement-breakpoint
ALTER TABLE `__new_project_operations` RENAME TO `project_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_operations_project_kind_idx` ON `project_operations` (`project_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_operations_command_idx` ON `project_operations` (`command_id`);--> statement-breakpoint
CREATE INDEX `project_operations_state_idx` ON `project_operations` (`state`);--> statement-breakpoint
CREATE INDEX `project_operations_project_idx` ON `project_operations` (`project_id`);--> statement-breakpoint
CREATE TABLE `__new_project_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`type` text NOT NULL,
	`host_id` text,
	`path` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_sources_shape_check" CHECK((
        "__new_project_sources"."type" = 'local_path' AND "__new_project_sources"."host_id" IS NOT NULL AND "__new_project_sources"."path" IS NOT NULL
      ))
);
--> statement-breakpoint
INSERT INTO `__new_project_sources`("id", "project_id", "type", "host_id", "path", "is_default", "created_at", "updated_at") SELECT "id", "project_id", "type", "host_id", "path", "is_default", "created_at", "updated_at" FROM `project_sources`;--> statement-breakpoint
DROP TABLE `project_sources`;--> statement-breakpoint
ALTER TABLE `__new_project_sources` RENAME TO `project_sources`;--> statement-breakpoint
CREATE INDEX `project_sources_project_idx` ON `project_sources` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_sources_host_idx` ON `project_sources` (`host_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_sources_project_host_idx` ON `project_sources` (`project_id`,`host_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `project_sources_default_project_idx`
ON `project_sources` (`project_id`)
WHERE `is_default` = 1;--> statement-breakpoint
CREATE TABLE `__new_terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`host_id` text NOT NULL,
	`daemon_session_id` text,
	`title` text NOT NULL,
	`initial_cwd` text NOT NULL,
	`current_cwd` text,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`close_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_user_input_at` integer,
	`last_connected_at` integer,
	`exited_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_terminal_sessions`("id", "thread_id", "environment_id", "host_id", "daemon_session_id", "title", "initial_cwd", "current_cwd", "cols", "rows", "status", "exit_code", "close_reason", "created_at", "updated_at", "last_user_input_at", "last_connected_at", "exited_at") SELECT "id", "thread_id", "environment_id", "host_id", "daemon_session_id", "title", "initial_cwd", "current_cwd", "cols", "rows", "status", "exit_code", "close_reason", "created_at", "updated_at", "last_user_input_at", "last_connected_at", "exited_at" FROM `terminal_sessions`;--> statement-breakpoint
DROP TABLE `terminal_sessions`;--> statement-breakpoint
ALTER TABLE `__new_terminal_sessions` RENAME TO `terminal_sessions`;--> statement-breakpoint
CREATE INDEX `terminal_sessions_thread_status_updated_idx` ON `terminal_sessions` (`thread_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_environment_status_idx` ON `terminal_sessions` (`environment_id`,`status`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_host_status_idx` ON `terminal_sessions` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_daemon_session_idx` ON `terminal_sessions` (`daemon_session_id`);--> statement-breakpoint
CREATE TABLE `__new_thread_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`provisioning_id` text,
	`provisioning_stage` text,
	`provisioning_environment_id` text,
	`provision_event_sequence` integer,
	`workspace_ready_event_sequence` integer,
	`command_id` text,
	`requested_at` integer NOT NULL,
	`queued_at` integer,
	`completed_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provisioning_environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_thread_operations`("id", "thread_id", "kind", "state", "payload", "provisioning_id", "provisioning_stage", "provisioning_environment_id", "provision_event_sequence", "workspace_ready_event_sequence", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at") SELECT "id", "thread_id", "kind", "state", "payload", "provisioning_id", "provisioning_stage", "provisioning_environment_id", "provision_event_sequence", "workspace_ready_event_sequence", "command_id", "requested_at", "queued_at", "completed_at", "failure_reason", "created_at", "updated_at" FROM `thread_operations`;--> statement-breakpoint
DROP TABLE `thread_operations`;--> statement-breakpoint
ALTER TABLE `__new_thread_operations` RENAME TO `thread_operations`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_operations_thread_kind_idx` ON `thread_operations` (`thread_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `thread_operations_command_idx` ON `thread_operations` (`command_id`);--> statement-breakpoint
CREATE INDEX `thread_operations_state_idx` ON `thread_operations` (`state`);--> statement-breakpoint
CREATE INDEX `thread_operations_thread_idx` ON `thread_operations` (`thread_id`);--> statement-breakpoint
PRAGMA foreign_keys=ON;