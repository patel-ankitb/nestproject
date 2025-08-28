import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  // ✅ Build Mongo URI dynamically from env vars
  const MONGO_URI = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_HOST}/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=${process.env.APP_NAME}`;

  await mongoose.connect(MONGO_URI);
  console.log('✅ MongoDB Connected', MONGO_URI);

  const server = app.getHttpAdapter().getInstance();

  // ✅ Get all documents
  server.get('/data/:collection', async (req, res) => {
    try {
      if (!mongoose.connection.db) {
        return res.status(500).json({ error: 'Database not connected' });
      }

      const { collection } = req.params;
      const data = await mongoose.connection.db
        .collection(collection)
        .find({})
        .limit(10)
        .toArray();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data', details: err.message });
    }
  });

  // ✅ Get one document by ID
  server.get('/data/:collection/:id', async (req, res) => {
    try {
      if (!mongoose.connection.db) {
        return res.status(500).json({ error: 'Database not connected' });
      }

      const { collection, id } = req.params;
      const { ObjectId } = mongoose.Types;

      const data = await mongoose.connection.db
        .collection(collection)
        .findOne({ _id: new ObjectId(id) });

      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data', details: err.message });
    }
  });

  await app.init();
  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`🚀 Server running on http://localhost:${port}`);
}

bootstrap();
