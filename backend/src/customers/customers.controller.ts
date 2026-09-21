import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomersService } from './customers.service.js';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Post('upload/preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadPreview(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded (field name must be "file")');
    return this.customers.previewFromBuffer(file.buffer, file.originalname);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(@UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No file uploaded (field name must be "file")');
    return this.customers.importFromBuffer(file.buffer, file.originalname);
  }

  @Get()
  async list(
    @Query() query: { search?: string; status?: string; page?: string; pageSize?: string },
  ) {
    return this.customers.list({
      search: query.search,
      status: query.status,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }
}
