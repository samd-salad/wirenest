CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ts` text DEFAULT (datetime('now')) NOT NULL,
	`actor` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`action` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`request_id` text,
	`reason` text
);
--> statement-breakpoint
CREATE INDEX `idx_change_log_ts` ON `change_log` (`ts`);--> statement-breakpoint
CREATE INDEX `idx_change_log_object` ON `change_log` (`object_type`,`object_id`);--> statement-breakpoint
CREATE INDEX `idx_change_log_request` ON `change_log` (`request_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_device` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`hostname` text,
	`type` text NOT NULL,
	`role` text,
	`make` text,
	`model` text,
	`serial_number` text,
	`os` text,
	`location` text,
	`status` text DEFAULT 'active' NOT NULL,
	`build_id` integer,
	`parent_device_id` integer,
	`primary_vlan_id` integer,
	`notes` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`source_ref` text,
	`user_override` integer DEFAULT false NOT NULL,
	`specs` text,
	`metadata` text,
	FOREIGN KEY (`build_id`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_vlan_id`) REFERENCES `vlan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_device`("id", "name", "hostname", "type", "role", "make", "model", "serial_number", "os", "location", "status", "build_id", "parent_device_id", "primary_vlan_id", "notes", "created_at", "updated_at", "source_id", "source_ref", "user_override", "specs", "metadata") SELECT "id", "name", "hostname", "type", "role", "make", "model", "serial_number", "os", "location", "status", "build_id", "parent_device_id", "primary_vlan_id", "notes", "created_at", "updated_at", "source_id", "source_ref", "user_override", "specs", "metadata" FROM `device`;--> statement-breakpoint
DROP TABLE `device`;--> statement-breakpoint
ALTER TABLE `__new_device` RENAME TO `device`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `device_name_unique` ON `device` (`name`);--> statement-breakpoint
CREATE INDEX `idx_device_type` ON `device` (`type`);--> statement-breakpoint
CREATE INDEX `idx_device_vlan` ON `device` (`primary_vlan_id`);--> statement-breakpoint
CREATE INDEX `idx_device_parent` ON `device` (`parent_device_id`);