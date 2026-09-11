import { Module } from '@nestjs/common';
import { TransactionRunner } from '../prisma/transaction.runner';
import { BusinessSequenceService } from './business-sequence.service';

/** 业务取号基础设施：一并导出共享 TransactionRunner */
@Module({
    providers: [BusinessSequenceService, TransactionRunner],
    exports: [BusinessSequenceService, TransactionRunner],
})
export class SequenceModule {}
