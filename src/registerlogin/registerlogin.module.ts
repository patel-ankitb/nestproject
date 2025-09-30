import { Module, forwardRef } from '@nestjs/common';
import { RegisterLoginService } from './registerlogin.service';
import { OtpService } from './otp';
import { RegisterLoginController } from './registerlogin.controller';
import { DatabaseService } from 'src/databases/database.service';

@Module({
  imports: [
    // forwardRef resolves circular dependency between RegisterLoginService <-> OtpService
    forwardRef(() => RegisterLoginModule),
  ],
  providers: [RegisterLoginService, OtpService,DatabaseService],
  exports: [RegisterLoginService, OtpService],
  controllers: [RegisterLoginController],
})
export class RegisterLoginModule {}
