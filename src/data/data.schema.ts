import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IoTDataDocument = IoTData & Document;

@Schema({ collection: 'iotdata' })
export class IoTData {
  @Prop({ type: Object })
  data: Record<string, any>;

  @Prop({ type: Date })
  time: Date;
}

export const IoTDataSchema = SchemaFactory.createForClass(IoTData);
