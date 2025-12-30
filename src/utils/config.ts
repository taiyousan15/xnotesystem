import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AppConfig } from '../types/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let configCache: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (configCache) {
    return configCache;
  }

  const configPath = join(__dirname, '../../config/config.json');
  const configData = readFileSync(configPath, 'utf-8');
  configCache = JSON.parse(configData) as AppConfig;

  return configCache;
}

export function reloadConfig(): AppConfig {
  configCache = null;
  return loadConfig();
}
