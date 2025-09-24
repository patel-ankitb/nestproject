import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import * as fs from 'fs';

async function bootstrap() {
  let app;

  // 🔹 SSL Cert check (local development self-signed certs)
  const keyPath = './certs/key.pem';
  const certPath = './certs/cert.pem';

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
    app = await NestFactory.create(AppModule, { httpsOptions });
    console.log('✅ HTTPS mode enabled');
  } else {
    app = await NestFactory.create(AppModule);
    console.log('⚠️ SSL certs not found, running in HTTP mode');
  }

  // 🔹 Global Validation
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  // 🔹 Enable CORS
  app.enableCors();

  // 🔹 Serve static uploads (always lowercase)
  app.use('/uploads', express.static(join(process.cwd(), 'uploads')));

  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`🚀 Server running at: ${await app.getUrl()}`);
}
bootstrap();
