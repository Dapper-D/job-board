#!/usr/bin/env node
// Removes the daily schedule and the shortcut and stops the board. Your data and documents folders are left alone.
import { unschedule, removeShortcut } from './lib/platform.mjs';
import { loadConfig } from './lib/config.mjs';

unschedule(); removeShortcut();
const port = loadConfig().port || 4777;
await fetch(`http://127.0.0.1:${port}/api/version`).then(() => console.log('The board server is still running; it stops when you restart the computer, or close it from Task Manager / Activity Monitor (node).'), () => {});
console.log('Removed the daily schedule and the shortcut. To delete everything, delete the kit folder.');
