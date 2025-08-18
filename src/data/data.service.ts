// import { Injectable } from '@nestjs/common';
// import { InjectModel } from '@nestjs/mongoose';
// import { Model } from 'mongoose';
// import { IoTData, IoTDataDocument } from './data.schema';

// @Injectable()
// export class DataService {
//     constructor(
//         @InjectModel(IoTData.name) private readonly iotDataModel: Model<IoTDataDocument>,
//     ) { }

//     async getAllData(): Promise<IoTData[]> {
//         try {
//             return await this.iotDataModel.find().limit(100).exec();
//         } catch (error) {
//             console.error('Error fetching IoT data:', error);
//             throw new Error('Unable to fetch IoT data');
//         }
//     }
//     async getDataById(id: string): Promise<IoTData | null> {
//         try {
//             return await this.iotDataModel.findById(id).exec();
//         } catch (error) {
//             console.error('Error fetching IoT data by ID:', error);
//             throw new Error('Unable to fetch IoT data by ID');
//         }
    
//     }
// }