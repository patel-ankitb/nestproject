// // otp.ts
// import { SMSService } from './smsservicce';
// import { RegisterLoginService } from './registerlogin.service';

// export async function sendOtp(email: string, length = 4, type = 2, appName: string) {
//   const regService = new RegisterLoginService(); // or inject properly
//   const { cn_str, dbName } = await (regService as any).resolveAppConfig(appName);

//   const appDb = await (regService as any).getConnection(cn_str, dbName);
//   const smsConfig = await appDb.collection('sms').findOne({}); // choose correct _id if multiple

//   const otp = Math.floor(1000 + Math.random() * 9000).toString();
//   const smsService = new SMSService();
//   console.log(" Sending OTP:", smsService);
//   await smsService.sendMessage(appName, cn_str, dbName, smsConfig._id.toString(), email, otp, 'otp');

//   return otp; // store in DB or cache as needed
// }
