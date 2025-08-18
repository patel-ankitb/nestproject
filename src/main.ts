  // src/main.ts
  import { NestFactory } from '@nestjs/core';
  import { AppModule } from './app.module';
  import { ExpressAdapter } from '@nestjs/platform-express';
  import express from 'express';
  import { Model } from 'mongoose';
  import { IoTData, IoTDataDocument } from './data/data.schema';
  import { getModelToken } from '@nestjs/mongoose';

  async function bootstrap() {
    // Create raw express server
    const expressApp = express();

    // Plug Express into NestJS
    const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

    // ✅ Use Nest DI container to get the Mongoose Model
    const iotDataModel: Model<IoTDataDocument> = app.get(getModelToken(IoTData.name));

    // ✅ Define express routes (no controllers)
    expressApp.get('/alldata', async (_req, res) => {
      try {
        const data = await iotDataModel.find().limit(100).exec();
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch data', details: err.message });
      }
    });

    expressApp.get('/alldata1/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const data = await iotDataModel.findById(id).exec();
        if (!data) return res.status(404).json({ error: 'Not found' });
        res.json(data);
      } catch (err) {
        res.status(500).json({ error: 'Failed to fetch data', details: err.message });
      }
    });

    // Start server
    await app.listen(3003);
    console.log(`🚀 Server running on http://localhost:3003`);
  }
  bootstrap();
