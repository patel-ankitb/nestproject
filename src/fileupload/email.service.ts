import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  async sendErrorMail(message: string, subject: string) {
    this.logger.error(`Email: ${subject}\n${message}`);
  }
}