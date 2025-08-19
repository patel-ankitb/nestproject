import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import mongoose from 'mongoose';

async function bootstrap() {
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  const server = app.getHttpAdapter().getInstance();

  // ✅ Get all documents from any collection
  server.get('/data/:collection', async (req, res) => {
    try {
      const { collection } = req.params;

      if (!mongoose.connection.db) {
        return res.status(500).json({ error: 'Database not connected' });
      }

      const data = await mongoose.connection.db
        .collection(collection) // dynamic collection
        .find({})
        .limit(100)
        .toArray();

      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data', details: err.message });
    }
  });

  // ✅ Get one document by ID from any collection
  server.get('/data/:collection/:id', async (req, res) => {
    try {
      const { collection, id } = req.params;

      if (!mongoose.connection.db) {
        return res.status(500).json({ error: 'Database not connected' });
      }

      const { ObjectId } = mongoose.Types;
      const data = await mongoose.connection.db
        .collection(collection) // dynamic collection
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
