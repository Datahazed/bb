CREATE TABLE `environment_git_status_snapshots` (
	`environment_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`git_status_json` text,
	`error_code` text,
	`error_message` text,
	`refreshed_at` integer,
	`next_refresh_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `environment_git_status_snapshots_next_refresh_idx` ON `environment_git_status_snapshots` (`next_refresh_at`);--> statement-breakpoint
CREATE TABLE `environment_pull_request_status_snapshots` (
	`environment_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`pull_request_json` text,
	`error_code` text,
	`error_message` text,
	`refreshed_at` integer,
	`next_refresh_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `environment_pull_request_status_snapshots_next_refresh_idx` ON `environment_pull_request_status_snapshots` (`next_refresh_at`);