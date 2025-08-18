import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import { Model } from 'mongoose';
import { IoTDataDocument, IoTData } from './data/data.schema';
import { getModelToken } from '@nestjs/mongoose';

async function bootstrap() {
  const expressApp = express();

  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));

  // Get the native express instance used by Nest
  const server = app.getHttpAdapter().getInstance();

  // Attach routes BEFORE init
  server.get('/alldata', async (_req, res) => {
    try {
      const iotDataModel: Model<IoTDataDocument> = app.get(getModelToken(IoTData.name));
      const data = await iotDataModel.find().limit(100).exec();
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data', details: err.message });
    }
  });

  server.get('/alldata1/:id', async (req, res) => {
    try {
      const iotDataModel: Model<IoTDataDocument> = app.get(getModelToken(IoTData.name));
      const { id } = req.params;
      const data = await iotDataModel.findById(id).exec();
      if (!data) return res.status(404).json({ error: 'Not found' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to fetch data', details: err.message });
    }
  });

  await app.init();
  await app.listen(3003);
  console.log(`🚀 Server running on http://localhost:3003`);
}
bootstrap();
