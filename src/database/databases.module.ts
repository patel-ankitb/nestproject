// import { Module, OnModuleInit } from '@nestjs/common';
// import { ConfigModule, ConfigService } from '@nestjs/config';
// import mongoose from 'mongoose';

// @Module({
//   imports: [ConfigModule], // ✅ required so ConfigService works
// })
// export class DatabaseModule implements OnModuleInit {
//   constructor(private readonly configService: ConfigService) {}

//   async onModuleInit() {
//     const uri = this.configService.get<string>('MONGO_URI');
//     if (!uri) {
//       console.error('❌ MONGO_URI is not defined in .env');
//       process.exit(1);
//     }

//     try {
//       await mongoose.connect(uri, {
//         useNewUrlParser: true,
//         useUnifiedTopology: true,
//       } as any);
//       console.log('✅ MongoDB connected');
//     } catch (err) {
//       console.error('❌ MongoDB connection failed:', err.message);
//       process.exit(1);
//     }
//   }
// }
