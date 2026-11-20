CREATE TABLE `credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`secret` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_columns` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `data_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`table_id` text NOT NULL,
	`values` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rows_table` ON `data_rows` (`table_id`);--> statement-breakpoint
CREATE TABLE `data_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `execution_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`execution_id` text NOT NULL,
	`position` integer NOT NULL,
	`step_id` text NOT NULL,
	`step_name` text NOT NULL,
	`step_type` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`reused` integer DEFAULT false NOT NULL,
	`started_at` integer NOT NULL,
	`duration_ms` integer
);
--> statement-breakpoint
CREATE INDEX `steps_execution` ON `execution_steps` (`execution_id`,`position`);--> statement-breakpoint
CREATE TABLE `executions` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`version` integer NOT NULL,
	`trigger_kind` text NOT NULL,
	`started_by_id` text,
	`started_by_email` text,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`graph` text NOT NULL,
	`error` text,
	`resume_at` integer,
	`retry_of` text,
	`started_at` integer NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `executions_workflow` ON `executions` (`workflow_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `executions_org` ON `executions` (`org_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`version` integer NOT NULL,
	`author_id` text NOT NULL,
	`author_email` text NOT NULL,
	`graph` text NOT NULL,
	`restored_from` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `versions_workflow` ON `workflow_versions` (`workflow_id`,`version`);--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT false NOT NULL,
	`graph` text NOT NULL,
	`trigger_kind` text NOT NULL,
	`version` integer NOT NULL,
	`webhook_token` text NOT NULL,
	`last_slot` integer,
	`last_run_status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflows_org` ON `workflows` (`org_id`);--> statement-breakpoint
CREATE INDEX `workflows_token` ON `workflows` (`webhook_token`);