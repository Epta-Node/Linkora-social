/**
 * DM Relay Server - Transport-only encrypted message relay for Linkora.
 * 
 * This server never has access to plaintext message content. All messages
 * are end-to-end encrypted using X25519 + ChaCha20-Poly1305.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { Database } from './database';
import { AuthService } from './auth';
import { CleanupService } from './cleanup';
import { createRouter } from './routes';
import {
  requestIdMiddleware,
  requestLoggerMiddleware,
  errorHandler,
  notFoundHandler,
  validateContentType,
} from './middleware';

// Load environment variables
dotenv.config();

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/linkora_dm_relay',
  corsOrigin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
  messageTtlDays: parseInt(process.env.MESSAGE_TTL_DAYS || '7'),
  maxTimestampSkew: parseInt(process.env.MAX_TIMESTAMP_SKEW || '30'),
  stellarNetwork: process.env.STELLAR_NETWORK || 'Testnet',
};

async function createApp() {
  const app = express();

  // Security middleware
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // CORS configuration
  app.use(cors({
    origin: config.corsOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false, // No cookies/credentials needed
  }));

  // Body parsing
  app.use(express.json({ limit: '1mb' })); // Limit request size

  // Custom middleware
  app.use(requestIdMiddleware);
  app.use(requestLoggerMiddleware);
  app.use(validateContentType);

  // Initialize database
  console.log('Connecting to database...');
  const database = new Database(config.databaseUrl);
  await database.init();

  // Initialize auth service
  const authService = new AuthService(config.maxTimestampSkew, config.stellarNetwork);

  // Initialize cleanup service
  const cleanupService = new CleanupService(database, config.messageTtlDays);
  cleanupService.start();

  // API routes
  app.use('/api', createRouter(database, authService));

  // Health check at root
  app.get('/', (req, res) => {
    res.json({
      service: 'linkora-dm-relay',
      version: '0.1.0',
      status: 'running',
      timestamp: new Date().toISOString(),
    });
  });

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Graceful shutdown
  const gracefulShutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}. Starting graceful shutdown...`);
    
    cleanupService.stop();
    await database.close();
    
    console.log('Graceful shutdown completed.');
    process.exit(0);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  return { app, database, cleanupService };
}

async function startServer() {
  try {
    const { app } = await createApp();

    const server = app.listen(config.port, () => {
      console.log(`
╭─────────────────────────────────────────────────╮
│  🔐 Linkora DM Relay Service                    │
│                                                 │
│  Port:        ${config.port.toString().padEnd(30)} │
│  Environment: ${config.nodeEnv.padEnd(30)} │
│  TTL:         ${config.messageTtlDays} days${' '.repeat(24)} │
│                                                 │
│  📡 Server running and ready for encrypted     │
│     message relay (transport-only mode)        │
╰─────────────────────────────────────────────────╯
      `);
    });

    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start server if this file is run directly
if (require.main === module) {
  startServer();
}

export { createApp, startServer };