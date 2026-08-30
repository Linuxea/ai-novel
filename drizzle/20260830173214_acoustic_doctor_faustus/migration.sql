CREATE TABLE `project_model_preferences` (
	`project_id` text NOT NULL,
	`role` text NOT NULL,
	`model_id` text NOT NULL,
	CONSTRAINT `project_model_preferences_pk` PRIMARY KEY(`project_id`, `role`),
	CONSTRAINT `fk_project_model_preferences_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON DELETE CASCADE,
	CONSTRAINT "project_model_preferences_role_check" CHECK("role" IN ('chat', 'writing', 'review', 'embedding')),
	CONSTRAINT "project_model_preferences_model_length_check" CHECK(length(trim("model_id")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY,
	`title` text NOT NULL,
	`subtitle` text,
	`genre` text NOT NULL,
	`premise` text NOT NULL,
	`target_audience` text NOT NULL,
	`target_word_count` integer NOT NULL,
	`status` text NOT NULL,
	`archived_from_status` text,
	`version` integer NOT NULL,
	`project_sequence` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "projects_title_length_check" CHECK(length(trim("title")) BETWEEN 1 AND 80),
	CONSTRAINT "projects_subtitle_length_check" CHECK("subtitle" IS NULL OR length(trim("subtitle")) BETWEEN 1 AND 120),
	CONSTRAINT "projects_genre_length_check" CHECK(length(trim("genre")) BETWEEN 1 AND 40),
	CONSTRAINT "projects_premise_length_check" CHECK(length(trim("premise")) BETWEEN 1 AND 2000),
	CONSTRAINT "projects_target_audience_length_check" CHECK(length(trim("target_audience")) BETWEEN 1 AND 200),
	CONSTRAINT "projects_target_word_count_check" CHECK("target_word_count" BETWEEN 1000 AND 10000000),
	CONSTRAINT "projects_status_check" CHECK("status" IN ('planning', 'writing', 'revising', 'completed', 'archived')),
	CONSTRAINT "projects_archive_state_check" CHECK((
        "status" = 'archived'
        AND "archived_from_status" IN ('planning', 'writing', 'revising', 'completed')
      ) OR (
        "status" <> 'archived'
        AND "archived_from_status" IS NULL
      )),
	CONSTRAINT "projects_version_check" CHECK("version" > 0),
	CONSTRAINT "projects_sequence_check" CHECK("project_sequence" > 0)
);
--> statement-breakpoint
CREATE INDEX `projects_status_updated_idx` ON `projects` (`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `projects_genre_idx` ON `projects` (`genre`);