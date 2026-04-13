CREATE TABLE `build` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'planning' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	`metadata` text
);
--> statement-breakpoint
CREATE TABLE `build_part` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`build_id` integer NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`specs` text,
	`price_cents` integer,
	`quantity` integer DEFAULT 1 NOT NULL,
	`vendor` text,
	`url` text,
	`status` text DEFAULT 'planned' NOT NULL,
	`salvaged` integer DEFAULT false NOT NULL,
	`ordered_at` text,
	`delivered_at` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`metadata` text,
	FOREIGN KEY (`build_id`) REFERENCES `build`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `connection` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`iface_a_id` integer NOT NULL,
	`iface_b_id` integer NOT NULL,
	`cable_type` text,
	`color` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`label` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`metadata` text,
	FOREIGN KEY (`iface_a_id`) REFERENCES `interface`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`iface_b_id`) REFERENCES `interface`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conn_a` ON `connection` (`iface_a_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_conn_b` ON `connection` (`iface_b_id`);--> statement-breakpoint
CREATE TABLE `credential` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`service_id` integer,
	`data_source_id` integer,
	`secret_ref` text NOT NULL,
	`type` text NOT NULL,
	`username` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`notes` text,
	FOREIGN KEY (`service_id`) REFERENCES `service`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `data_source` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`config` text,
	`last_sync_at` text,
	`sync_interval_sec` integer,
	`enabled` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `data_source_name_unique` ON `data_source` (`name`);--> statement-breakpoint
CREATE TABLE `device` (
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
	FOREIGN KEY (`primary_vlan_id`) REFERENCES `vlan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_name_unique` ON `device` (`name`);--> statement-breakpoint
CREATE INDEX `idx_device_type` ON `device` (`type`);--> statement-breakpoint
CREATE INDEX `idx_device_vlan` ON `device` (`primary_vlan_id`);--> statement-breakpoint
CREATE INDEX `idx_device_parent` ON `device` (`parent_device_id`);--> statement-breakpoint
CREATE TABLE `entity_tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tag_id` integer NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_entity_tag` ON `entity_tag` (`tag_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_entity_tag_lookup` ON `entity_tag` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `field_override` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`field_name` text NOT NULL,
	`value` text,
	`overridden_at` text DEFAULT (datetime('now')) NOT NULL,
	`reason` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_override` ON `field_override` (`entity_type`,`entity_id`,`field_name`);--> statement-breakpoint
CREATE TABLE `firewall_rule` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fw_interface` text NOT NULL,
	`rule_number` integer,
	`action` text NOT NULL,
	`direction` text DEFAULT 'in' NOT NULL,
	`protocol` text,
	`source_net` text,
	`source_port` text,
	`dest_net` text,
	`dest_port` text,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`metadata` text,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `interface` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`device_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'ethernet' NOT NULL,
	`mac_address` text,
	`port_number` integer,
	`mgmt_only` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`speed` integer,
	`dot1q_mode` text,
	`untagged_vlan_id` integer,
	`poe_watts` real,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`source_ref` text,
	`user_override` integer DEFAULT false NOT NULL,
	`metadata` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`untagged_vlan_id`) REFERENCES `vlan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_iface_device_name` ON `interface` (`device_id`,`name`);--> statement-breakpoint
CREATE INDEX `idx_iface_device` ON `interface` (`device_id`);--> statement-breakpoint
CREATE TABLE `interface_tagged_vlan` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`interface_id` integer NOT NULL,
	`vlan_id` integer NOT NULL,
	FOREIGN KEY (`interface_id`) REFERENCES `interface`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`vlan_id`) REFERENCES `vlan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_iface_vlan` ON `interface_tagged_vlan` (`interface_id`,`vlan_id`);--> statement-breakpoint
CREATE TABLE `ip_address` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`address` text NOT NULL,
	`address_bare` text NOT NULL,
	`interface_id` integer,
	`vlan_id` integer,
	`assignment_type` text DEFAULT 'static' NOT NULL,
	`dns_name` text,
	`is_primary` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`source_ref` text,
	`user_override` integer DEFAULT false NOT NULL,
	`metadata` text,
	FOREIGN KEY (`interface_id`) REFERENCES `interface`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`vlan_id`) REFERENCES `vlan`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_ip_address` ON `ip_address` (`address`);--> statement-breakpoint
CREATE INDEX `idx_ip_bare` ON `ip_address` (`address_bare`);--> statement-breakpoint
CREATE INDEX `idx_ip_iface` ON `ip_address` (`interface_id`);--> statement-breakpoint
CREATE INDEX `idx_ip_vlan` ON `ip_address` (`vlan_id`);--> statement-breakpoint
CREATE TABLE `metric` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` integer NOT NULL,
	`name` text NOT NULL,
	`value` real NOT NULL,
	`unit` text,
	`recorded_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_metric_entity` ON `metric` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_metric_time` ON `metric` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_metric_lookup` ON `metric` (`entity_type`,`entity_id`,`name`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `service` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`device_id` integer NOT NULL,
	`web_url` text,
	`api_url` text,
	`api_auth_type` text,
	`icon` text,
	`category` text,
	`status` text DEFAULT 'unknown' NOT NULL,
	`version` text,
	`ports` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`source_ref` text,
	`user_override` integer DEFAULT false NOT NULL,
	`metadata` text,
	FOREIGN KEY (`device_id`) REFERENCES `device`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_service_device` ON `service` (`device_id`);--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`started_at` text DEFAULT (datetime('now')) NOT NULL,
	`completed_at` text,
	`status` text DEFAULT 'running' NOT NULL,
	`rows_created` integer DEFAULT 0,
	`rows_updated` integer DEFAULT 0,
	`rows_skipped` integer DEFAULT 0,
	`error_message` text,
	`details` text,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`color` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);--> statement-breakpoint
CREATE TABLE `vlan` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`subnet` text NOT NULL,
	`gateway` text NOT NULL,
	`dhcp_range_start` text,
	`dhcp_range_end` text,
	`dhcp_policy` text,
	`purpose` text,
	`color` text,
	`fw_interface` text,
	`created_at` text DEFAULT (datetime('now')) NOT NULL,
	`updated_at` text DEFAULT (datetime('now')) NOT NULL,
	`source_id` integer,
	`metadata` text,
	FOREIGN KEY (`source_id`) REFERENCES `data_source`(`id`) ON UPDATE no action ON DELETE no action
);
