/**
 * Persistent Logging Utility
 * 
 * Provides file-based logging with rotation capabilities.
 * Logs are written to the logs/ directory with JSON formatting for easy parsing.
 * 
 * Architecture Decision:
 * - File-based logging ensures logs persist across server restarts
 * - JSON format enables structured logging and easy log aggregation
 * - Log rotation prevents disk space exhaustion
 * - Circular buffer prevents memory bloat from large log objects
 * - Environment variables control logging behavior for production flexibility
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createLogger as createContextLogger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logger = createContextLogger('PersistentLogger');

// Configuration from environment variables
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../../logs');
const LOG_MAX_SIZE = parseInt(process.env.LOG_MAX_SIZE || '10485760', 10); // 10MB default
const LOG_MAX_FILES = parseInt(process.env.LOG_MAX_FILES || '10', 10); // Keep 10 rotated files

// Log level hierarchy
const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const currentLogLevel = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.info;

/**
 * Ensure logs directory exists
 */
const ensureLogDirectory = () => {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      logger.info('Created logs directory', { path: LOG_DIR });
    }
  } catch (error) {
    console.error('Failed to create logs directory', error);
  }
};

/**
 * Get the current log file path
 */
const getLogFilePath = (type = 'app') => {
  const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `${type}-${timestamp}.log`);
};

/**
 * Get archived log file path with rotation number
 */
const getArchivedLogPath = (type = 'app', rotationNumber) => {
  const timestamp = new Date().toISOString().split('T')[0];
  return path.join(LOG_DIR, `${type}-${timestamp}.log.${rotationNumber}`);
};

/**
 * Rotate log file when it exceeds max size
 */
const rotateLogFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return;
    }

    const stats = fs.statSync(filePath);
    if (stats.size <= LOG_MAX_SIZE) {
      return;
    }

    // Find the next available rotation number
    let rotationNumber = 1;
    let archivedPath = getArchivedLogPath(path.basename(filePath).split('-')[0], rotationNumber);
    
    while (fs.existsSync(archivedPath) && rotationNumber < LOG_MAX_FILES) {
      rotationNumber++;
      archivedPath = getArchivedLogPath(path.basename(filePath).split('-')[0], rotationNumber);
    }

    if (rotationNumber < LOG_MAX_FILES) {
      fs.renameSync(filePath, archivedPath);
      logger.info('Rotated log file', { from: filePath, to: archivedPath });
    } else {
      // Delete oldest file and rotate others
      for (let i = LOG_MAX_FILES - 1; i > 0; i--) {
        const currentPath = getArchivedLogPath(path.basename(filePath).split('-')[0], i);
        const nextPath = getArchivedLogPath(path.basename(filePath).split('-')[0], i + 1);
        if (fs.existsSync(currentPath)) {
          fs.renameSync(currentPath, nextPath);
        }
      }
      fs.renameSync(filePath, getArchivedLogPath(path.basename(filePath).split('-')[0], 1));
      logger.info('Rotated log files (max reached)', { kept: LOG_MAX_FILES });
    }
  } catch (error) {
    console.error('Failed to rotate log file', error);
  }
};

/**
 * Safely serialize data for logging (prevents circular references)
 */
const serializeData = (data, seen = new WeakSet()) => {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  if (seen.has(data)) {
    return '[Circular Reference]';
  }

  seen.add(data);

  if (Array.isArray(data)) {
    return data.map(item => serializeData(item, seen));
  }

  if (data instanceof Error) {
    return {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
  }

  const serialized = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      serialized[key] = serializeData(data[key], seen);
    }
  }

  return serialized;
};

/**
 * Write log entry to file
 */
const writeLogToFile = (type = 'app', level, context, message, data = null) => {
  try {
    const filePath = getLogFilePath(type);
    
    // Check if rotation is needed
    rotateLogFile(filePath);

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      context,
      message,
      pid: process.pid,
      ...(data && { data: serializeData(data) }),
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    // Append to file
    fs.appendFileSync(filePath, logLine, { encoding: 'utf8' });
  } catch (error) {
    console.error('Failed to write log to file', error);
  }
};

/**
 * Create a persistent logger instance
 */
export const createPersistentLogger = (context = 'App', type = 'app') => {
  ensureLogDirectory();

  return {
    info(message, data = null) {
      if (LOG_LEVELS.info <= currentLogLevel) {
        writeLogToFile(type, 'info', context, message, data);
      }
    },

    warn(message, data = null) {
      if (LOG_LEVELS.warn <= currentLogLevel) {
        writeLogToFile(type, 'warn', context, message, data);
      }
    },

    error(message, error = null, data = null) {
      if (LOG_LEVELS.error <= currentLogLevel) {
        writeLogToFile(type, 'error', context, message, {
          error: error?.message,
          stack: error?.stack,
          ...data,
        });
      }
    },

    debug(message, data = null) {
      if (LOG_LEVELS.debug <= currentLogLevel) {
        writeLogToFile(type, 'debug', context, message, data);
      }
    },
  };
};

/**
 * Get recent log entries from file
 * 
 * @param {number} lines - Number of recent lines to retrieve
 * @param {string} type - Log type ('app', 'error', etc.)
 * @returns {Array} Array of parsed log entries
 */
export const getRecentLogs = (lines = 100, type = 'app') => {
  try {
    const filePath = getLogFilePath(type);
    
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const logLines = content.trim().split('\n').filter(line => line.trim());
    
    // Get last N lines
    const recentLines = logLines.slice(Math.max(0, logLines.length - lines));
    
    return recentLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { text: line };
      }
    });
  } catch (error) {
    console.error('Failed to read logs', error);
    return [];
  }
};

/**
 * Clear old log files (older than specified days)
 * 
 * @param {number} days - Remove files older than this many days
 */
export const clearOldLogs = (days = 7) => {
  try {
    ensureLogDirectory();
    
    const now = Date.now();
    const maxAge = days * 24 * 60 * 60 * 1000;
    let removed = 0;

    fs.readdirSync(LOG_DIR).forEach(file => {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        removed++;
      }
    });

    if (removed > 0) {
      logger.info('Cleared old log files', { count: removed, days });
    }
  } catch (error) {
    console.error('Failed to clear old logs', error);
  }
};

export default {
  createPersistentLogger,
  getRecentLogs,
  clearOldLogs,
  ensureLogDirectory,
};
