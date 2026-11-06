// Entry point for the packaged B3spoken.exe.
import { start } from './main.mjs';
start().catch(e => { console.error(`B3spoken couldn't start: ${e.message}`); process.exitCode = 1; });
