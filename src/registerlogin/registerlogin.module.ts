import { Module } from '@nestjs/common';
import { RegisterLoginService } from './registerlogin.service';
import { OtpService } from './otp';
import { RegisterLoginController } from './registerlogin.controller';
import { DatabaseService } from 'src/databases/database.service';
import { EmailService } from './emailservice';   // ✅ import EmailService
import { SMSService } from './smsservicce';      // ✅ import SMSService (if used)

@Module({
  imports: [], // ❌ remove forwardRef(() => RegisterLoginModule) – self-import not needed
  providers: [
    RegisterLoginService,
    OtpService,
    DatabaseService,
    EmailService,   // ✅ added
    SMSService,     // ✅ added
  ],
  exports: [
    RegisterLoginService,
    OtpService,
    EmailService,   // ✅ export if needed outside
    SMSService,     // ✅ export if needed outside
  ],
  controllers: [RegisterLoginController],
})
export class RegisterLoginModule {}
