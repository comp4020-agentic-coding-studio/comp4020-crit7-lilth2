CREATE TABLE `bookings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`title` text NOT NULL,
	`booked_by` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`building` text NOT NULL,
	`capacity` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_name_unique` ON `rooms` (`name`);