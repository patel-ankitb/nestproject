import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import * as mime from 'mime-types';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import mongoose, { Connection } from 'mongoose';

@Injectable()
export class UploadService {
  private readonly baseUploadPath = path.join(process.cwd(), 'uploads');
  private readonly logger = new Logger(UploadService.name);

  private connectionCache: Map<string, Connection> = new Map();

  constructor() {
    if (!fs.existsSync(this.baseUploadPath)) {
      fs.mkdirSync(this.baseUploadPath, { recursive: true });
    }
  }

  private validateInput(body: any): void {
    if (
      body.quality &&
      (isNaN(parseInt(body.quality)) ||
        parseInt(body.quality) <= 0 ||
        parseInt(body.quality) > 100)
    ) {
      throw new Error('quality must be a number between 1 and 100');
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\s+/g, '_')
      .substring(0, 200);
  }

  private async manipulateImage(
    inputPath: string,
    options: {
      width?: number | null;
      height?: number | null;
      format?: string;
      quality?: number;
      outputPath?: string;
    },
  ): Promise<string> {
    let { width, height, format, quality = 80, outputPath } = options;
    const finalFormat =
      format || path.extname(inputPath).slice(1).toLowerCase();

    const output =
      outputPath ||
      path.join(path.dirname(inputPath), `${Date.now()}.${finalFormat}`);

    let image = sharp(inputPath).resize(width || null, height || null, {
      fit: 'inside',
    });

    image = image.toFormat(finalFormat as any, { quality });
    await image.toFile(output);

    return output;
  }

  private async getConnection(cnStr: string, dbName: string): Promise<Connection> {
    const cacheKey = `${cnStr}_${dbName}`;
    if (this.connectionCache.has(cacheKey)) {
      return this.connectionCache.get(cacheKey)!;
    }

    const conn = await mongoose.createConnection(cnStr, { dbName }).asPromise();
    this.connectionCache.set(cacheKey, conn);
    return conn;
  }

  async processFileUpload(
    appnm: string,
    moduleName: string,
    file: Express.Multer.File,
    body: any,
  ) {
    let finalFilePath = '';
    try {
      this.validateInput(body);
      if (!file) throw new Error('File is missing.');

      // 🔹 Step 1: connect to master/config DB
      const masterConn = await this.getConnection(
        process.env.MONGO_URI!,
        process.env.CONFIG_DB!,
      );

      // ✅ Use custom_apps instead of apps
      const AppModel = masterConn.model(
        'custom_apps',
        new mongoose.Schema({}, { strict: false }),
        'custom_apps',
      );

      // 🔹 Step 2: fetch app config by appnm
      const appDoc = await AppModel.findOne({ appnm }).lean<any>();
      if (!appDoc) throw new Error(`App '${appnm}' not found`);

      const { cn_str, db } = (appDoc.info as any) || {};
      if (!cn_str || !db) {
        throw new Error(`Invalid info for app '${appnm}'`);
      }

      // 🔹 Step 3: connect to app-specific DB
      const appConn = await this.getConnection(cn_str, db);

      // ✅ Fetch from objectStorage collection
      const ObjectStorageModel = appConn.model(
        'objectStorage',
        new mongoose.Schema({}, { strict: false }),
        'objectStorage',
      );

      const objectStorageDoc = await ObjectStorageModel.findOne().lean<any>();
      if (!objectStorageDoc) {
        throw new Error(`objectStorage config not found for app '${appnm}'`);
      }

      // ✅ Extract nested config
      const objectStorageConfig = objectStorageDoc.sectionData?.Objectstorage;
      if (!objectStorageConfig) {
        throw new Error(`objectStorage config invalid for app '${appnm}'`);
      }

      const storageType = objectStorageConfig.type || 'Local';

      // Common file info
      const mimeType = mime.lookup(file.originalname) || '';
      const ext = path.extname(file.originalname).slice(1);
      const generatedName = this.sanitizeFilename(
        `${Date.now()}-${file.originalname}`,
      );
      const fieldName = file.fieldname || 'file';

      finalFilePath = path.join(this.baseUploadPath, appnm, moduleName, generatedName);
      let wasOptimized = false;

      // 🔹 Optimize if required
      if (body.optimize === 'true' && mimeType.startsWith('image/')) {
        await this.manipulateImage(file.path, {
          width: body.resizeWidth ? parseInt(body.resizeWidth, 10) : null,
          height: body.resizeHeight ? parseInt(body.resizeHeight, 10) : null,
          format: body.format || ext,
          outputPath: finalFilePath,
          quality: body.quality ? parseInt(body.quality, 10) : 80,
        });
        wasOptimized = true;
      } else {
        fs.mkdirSync(path.dirname(finalFilePath), { recursive: true });
        fs.renameSync(file.path, finalFilePath);
      }

      // 🔹 Case 1: Upload to S3
      if (['S3 Compatible', 'AWS S3'].includes(storageType)) {
        const { bucketName, region, accessKey, secretKey, endpoint } = objectStorageConfig;

        // 👇 `body.filename` ne sub-folder banavyu
        const subFolder = body.filename ? `/${body.filename}` : '';
        const folder = `${appnm}/${moduleName}${subFolder}`;
        const s3FilePath = `${folder}/${generatedName}`;

        const s3Client = new S3Client({
          endpoint: storageType === 'S3 Compatible'
            ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`)
            : undefined,
          region,
          credentials: {
            accessKeyId: accessKey,
            secretAccessKey: secretKey,
          },
          forcePathStyle: storageType === 'S3 Compatible',
        });

        const fileContent = fs.readFileSync(finalFilePath);
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: s3FilePath,
            Body: fileContent,
          }),
        );

        // cleanup local
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);

        // ✅ Always return same format URL
        const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${s3FilePath}`;

        return {
          success: true,
          message: 'File uploaded successfully to S3',
          optimized: wasOptimized,
          filename: generatedName,
          fieldName,
          filePath: fileUrl,
        };
      }

      // 🔹 Case 2: Local storage
      const domain = `http://${process.env.HOST || 'localhost'}:${
        process.env.PORT || 3003
      }`;

      const subFolder = body.filename ? `/${body.filename}` : '';
      const relativePath = `uploads/${appnm}/${moduleName}${subFolder}/${generatedName}`;
      const publicUrl = `${domain}/${relativePath}`;

      return {
        success: true,
        message: 'File uploaded successfully to local storage',
        optimized: wasOptimized,
        filename: generatedName,
        filePath: publicUrl,
      };
    } catch (error: any) {
      this.logger.error('Upload failed', error.stack || error.message);
      throw error;
    } finally {
      // always cleanup temp file
      if (file?.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    }
  }
}
