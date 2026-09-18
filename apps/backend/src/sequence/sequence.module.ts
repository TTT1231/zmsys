import { Module } from '@nestjs/common';
import { BusinessSequenceService } from './business-sequence.service';

/** 业务取号基础设施；共享 TransactionRunner 由全局 PrismaModule 提供 */
@Module({
    providers: [BusinessSequenceService],
    exports: [BusinessSequenceService],
})
export class SequenceModule {}
