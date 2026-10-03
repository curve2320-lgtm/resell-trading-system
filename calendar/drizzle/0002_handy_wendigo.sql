ALTER TABLE `release_sources` ADD `result_revision_at` text;--> statement-breakpoint
ALTER TABLE `release_sources` ADD `result_claim_token` text;--> statement-breakpoint
ALTER TABLE `release_sources` ADD `result_claimed_at` text;--> statement-breakpoint
ALTER TABLE `review_items` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `review_items` ADD `claimed_at` text;