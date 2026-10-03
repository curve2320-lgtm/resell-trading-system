CREATE TABLE IF NOT EXISTS `collection_slots` (
	`slot_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `release_catalog` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_key` text NOT NULL,
	`title` text NOT NULL,
	`brand` text,
	`category` text,
	`release_kind` text,
	`release_date` text,
	`release_time` text,
	`status` text NOT NULL,
	`confidence` integer NOT NULL,
	`first_seen_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`last_verified_at` text,
	`changed_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `release_catalog_canonical_key_unique` ON `release_catalog` (`canonical_key`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `release_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`release_id` text NOT NULL,
	`field` text NOT NULL,
	`previous_value` text,
	`next_value` text,
	`changed_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release_catalog`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `release_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`release_id` text NOT NULL,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`retailer` text,
	`product_url` text,
	`source_url` text,
	`price_label` text,
	`release_date` text,
	`release_time` text,
	`collected_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release_catalog`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `release_channels_source_external_unique` ON `release_channels` (`source_key`,`external_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `release_sources` (
	`source_key` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`last_success_at` text,
	`last_failure_at` text,
	`consecutive_failures` integer NOT NULL,
	`source_count` integer NOT NULL,
	`new_count` integer NOT NULL,
	`merged_count` integer NOT NULL,
	`review_count` integer NOT NULL,
	`message` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `review_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_key` text NOT NULL,
	`external_id` text NOT NULL,
	`reason` text NOT NULL,
	`payload_json` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`resolved_by` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `saved_releases` (
	`user_email` text NOT NULL,
	`release_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`release_id`) REFERENCES `release_catalog`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `saved_releases_user_release_unique` ON `saved_releases` (`user_email`,`release_id`);
