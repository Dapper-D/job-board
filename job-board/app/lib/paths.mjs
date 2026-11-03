// Where everything lives. KIT_HOME can override for tests.
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

export const APP = dirname(dirname(fileURLToPath(import.meta.url)));
export const KIT = resolve(process.env.KIT_HOME || join(APP, '..'));
export const DATA = join(KIT, 'data');
export const CONFIG = join(KIT, 'config.json');
export const ENV = join(KIT, '.env');
export const CAREER_OPS = resolve(process.env.CAREER_OPS_DIR || join(KIT, 'career-ops'));
export const LOGS = join(KIT, 'logs');
export const LIB_FILE = join(DATA, 'resume-lib.json');
