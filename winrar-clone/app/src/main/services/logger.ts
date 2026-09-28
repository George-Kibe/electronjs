import log from 'electron-log/main';

log.initialize();
log.transports.file.maxSize = 5 * 1024 * 1024;
// File names are user data: keep them out of logs unless debugging (docs/02 §6).
log.transports.file.level = 'info';

export const logger = log;
