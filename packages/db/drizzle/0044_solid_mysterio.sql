DROP INDEX `thread_folders_path_idx`;--> statement-breakpoint
ALTER TABLE `thread_folders` ADD `project_id` text REFERENCES projects(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_folders_global_path_idx` ON `thread_folders` (`path`) WHERE "thread_folders"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_folders_project_path_idx` ON `thread_folders` (`project_id`,`path`) WHERE "thread_folders"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `thread_folders_project_idx` ON `thread_folders` (`project_id`);
