import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { sql } from 'drizzle-orm';
import * as schema from './schema';
import { resolve, join } from 'path';
import { existsSync, mkdirSync, copyFileSync, readdirSync, unlinkSync, statSync } from 'fs';

// Use AppData/Local on Windows, ~/.local/share on Linux — NOT inside OneDrive
function getDbDir(): string {
	const appData = process.env.LOCALAPPDATA
		?? process.env.XDG_DATA_HOME
		?? join(process.env.HOME ?? '.', '.local', 'share');
	const dir = join(appData, 'wirenest');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return dir;
}

const DB_DIR = getDbDir();
const DB_PATH = join(DB_DIR, 'wirenest.db');

// One-time migration: copy old DB from project local/ to safe location
const oldDbPath = resolve('local', 'wirenest.db');
if (existsSync(oldDbPath) && !existsSync(DB_PATH)) {
	try {
		copyFileSync(oldDbPath, DB_PATH);
		const oldWal = oldDbPath + '-wal';
		const oldShm = oldDbPath + '-shm';
		if (existsSync(oldWal)) copyFileSync(oldWal, DB_PATH + '-wal');
		if (existsSync(oldShm)) copyFileSync(oldShm, DB_PATH + '-shm');
		console.log(`[db] Migrated database from ${oldDbPath} to ${DB_PATH}`);
	} catch (e) {
		console.error(`[db] Migration failed:`, e);
	}
}

console.log(`[db] Database location: ${DB_PATH}`);

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
export { DB_PATH, DB_DIR };

/**
 * Back up the database on startup. Keeps the last 5 backups.
 */
function backupDb() {
	if (!existsSync(DB_PATH)) return;

	const backupDir = join(DB_DIR, 'backups');
	if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const backupPath = join(backupDir, `wirenest-${timestamp}.db`);

	try {
		// Use SQLite's backup API for a consistent copy
		sqlite.backup(backupPath)
			.then(() => {
				console.log(`[db] Backup created: ${backupPath}`);
				pruneBackups(backupDir, 5);
			})
			.catch((err: Error) => {
				console.error(`[db] Backup failed: ${err.message}`);
				// Fallback: file copy (less safe but better than nothing)
				try {
					copyFileSync(DB_PATH, backupPath);
					console.log(`[db] Backup created (file copy): ${backupPath}`);
					pruneBackups(backupDir, 5);
				} catch (e) {
					console.error(`[db] File copy backup also failed:`, e);
				}
			});
	} catch {
		// Sync fallback
		try {
			copyFileSync(DB_PATH, backupPath);
			console.log(`[db] Backup created (file copy): ${backupPath}`);
			pruneBackups(backupDir, 5);
		} catch (e) {
			console.error(`[db] Backup failed:`, e);
		}
	}
}

function pruneBackups(dir: string, keep: number) {
	try {
		const files = readdirSync(dir)
			.filter(f => f.startsWith('wirenest-') && f.endsWith('.db'))
			.map(f => ({ name: f, time: statSync(join(dir, f)).mtimeMs }))
			.sort((a, b) => b.time - a.time);

		for (const file of files.slice(keep)) {
			unlinkSync(join(dir, file.name));
			console.log(`[db] Pruned old backup: ${file.name}`);
		}
	} catch { /* ignore pruning errors */ }
}

export function initDb() {
	// Run migrations
	migrate(db, { migrationsFolder: resolve('drizzle') });

	// Back up after successful migration
	backupDb();

	// Seed defaults
	const manual = db.select().from(schema.dataSource)
		.where(sql`name = 'manual'`).get();
	if (!manual) {
		db.insert(schema.dataSource).values({
			name: 'manual',
			type: 'user',
			config: {},
		}).run();
	}

	const yamlImport = db.select().from(schema.dataSource)
		.where(sql`name = 'yaml-import'`).get();
	if (!yamlImport) {
		db.insert(schema.dataSource).values({
			name: 'yaml-import',
			type: 'import',
			config: {},
		}).run();
	}

	const inventoryBuild = db.select().from(schema.build)
		.where(sql`name = 'Inventory — On Hand'`).get();
	if (!inventoryBuild) {
		db.insert(schema.build).values({
			name: 'Inventory — On Hand',
			description: 'Parts on hand not assigned to a specific build',
			status: 'planning',
		}).run();
	}
}
