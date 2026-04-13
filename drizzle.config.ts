import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

// Match the runtime DB path from src/lib/server/db/index.ts
const appData = process.env.LOCALAPPDATA
	?? process.env.XDG_DATA_HOME
	?? join(process.env.HOME ?? '.', '.local', 'share');
const dbPath = join(appData, 'wirenest', 'wirenest.db');

export default defineConfig({
	schema: './src/lib/server/db/schema.ts',
	out: './drizzle',
	dialect: 'sqlite',
	dbCredentials: {
		url: dbPath,
	},
});
