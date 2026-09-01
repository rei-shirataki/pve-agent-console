CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text,
	`tool_name` text NOT NULL,
	`arguments_json` text,
	`risk_tier` text,
	`decision` text NOT NULL,
	`decided_by` text,
	`asked_at` text NOT NULL,
	`decided_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_log_task_id_idx` ON `audit_log` (`task_id`);--> statement-breakpoint
CREATE INDEX `audit_log_session_id_idx` ON `audit_log` (`session_id`);--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_comments_task_id_idx` ON `task_comments` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`priority` text DEFAULT 'medium' NOT NULL,
	`origin` text NOT NULL,
	`source_task_id` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`opencode_session_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
