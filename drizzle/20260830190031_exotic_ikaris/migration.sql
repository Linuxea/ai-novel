CREATE TABLE `project_catalog_state` (
	`id` integer PRIMARY KEY,
	`version` integer NOT NULL,
	CONSTRAINT "project_catalog_state_singleton_check" CHECK("id" = 1),
	CONSTRAINT "project_catalog_state_version_check" CHECK("version" >= 0)
);
--> statement-breakpoint
INSERT INTO `project_catalog_state` (`id`, `version`) VALUES (1, 0);
