/**
 * 应用层 Snowflake 主键：63 位有符号 BIGINT 内的时间戳左移 + 机器位 + 序列。
 * 1–9999 保留给迁移脚本固定参考数据，本生成器产出的 id 远大于该区间。
 */
const EPOCH = 1_735_689_600_000n; // 2025-01-01T00:00:00.000Z
const WORKER_BITS = 10n;
const SEQUENCE_BITS = 12n;
const MAX_SEQUENCE = (1n << SEQUENCE_BITS) - 1n;
const MAX_WORKER_ID = (1n << WORKER_BITS) - 1n;

export class SnowflakeGenerator {
    private lastTimestamp = -1n;
    private sequence = 0n;

    constructor(private readonly workerId: bigint) {
        if (workerId < 0n || workerId > MAX_WORKER_ID) {
            throw new Error(`workerId 必须在 0-${MAX_WORKER_ID} 之间`);
        }
    }

    next(): bigint {
        let timestamp = BigInt(Date.now());
        if (timestamp < this.lastTimestamp) {
            throw new Error('系统时钟回拨，拒绝生成 id');
        }
        if (timestamp === this.lastTimestamp) {
            this.sequence = (this.sequence + 1n) & MAX_SEQUENCE;
            if (this.sequence === 0n) {
                do {
                    timestamp = BigInt(Date.now());
                } while (timestamp <= this.lastTimestamp);
            }
        } else {
            this.sequence = 0n;
        }
        this.lastTimestamp = timestamp;
        return (
            ((timestamp - EPOCH) << (WORKER_BITS + SEQUENCE_BITS)) | (this.workerId << SEQUENCE_BITS) | this.sequence
        );
    }
}
