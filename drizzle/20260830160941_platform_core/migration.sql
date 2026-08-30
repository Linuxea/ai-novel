CREATE TABLE `domain_events` (
	`id` text PRIMARY KEY,
	`event_id` text NOT NULL,
	`event_name` text NOT NULL,
	`envelope_json` text NOT NULL,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`available_at` text,
	`lease_owner` text,
	`lease_token` text,
	`lease_expires_at` text,
	`published_at` text,
	`failed_at` text,
	`failure_code` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "domain_events_status_check" CHECK("status" IN ('pending', 'processing', 'published', 'failed')),
	CONSTRAINT "domain_events_attempts_check" CHECK("attempts" >= 0),
	CONSTRAINT "domain_events_max_attempts_check" CHECK("max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE `job_events` (
	`cursor` integer PRIMARY KEY AUTOINCREMENT,
	`job_id` text NOT NULL,
	`event_type` text NOT NULL,
	`data_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT `fk_job_events_job_id_jobs_id_fk` FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`run_at` text NOT NULL,
	`lease_owner` text,
	`lease_token` text,
	`lease_expires_at` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`result_json` text,
	`error_json` text,
	`cancel_requested_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`started_at` text,
	`finished_at` text,
	CONSTRAINT "jobs_status_check" CHECK("status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempt_check" CHECK("attempt" >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK("max_attempts" > 0),
	CONSTRAINT "jobs_progress_check" CHECK("progress" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_events_event_id_unique` ON `domain_events` (`event_id`);--> statement-breakpoint
CREATE INDEX `domain_events_dispatch_idx` ON `domain_events` (`status`,`available_at`,`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `job_events_job_cursor_idx` ON `job_events` (`job_id`,`cursor`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_type_idempotency_unique` ON `jobs` (`type`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `jobs_claim_idx` ON `jobs` (`status`,`run_at`,`lease_expires_at`);