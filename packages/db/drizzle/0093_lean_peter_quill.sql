ALTER TABLE `environments` ADD `managed_source_path` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `continuation_branch_name` text;--> statement-breakpoint
UPDATE `environments`
SET `managed_source_path` = (
	SELECT `project_sources`.`path`
	FROM `project_sources`
	WHERE `project_sources`.`project_id` = `environments`.`project_id`
		AND `project_sources`.`host_id` = `environments`.`host_id`
		AND `project_sources`.`type` = 'local_path'
	LIMIT 1
)
WHERE `environments`.`workspace_provision_type` = 'managed-worktree';
