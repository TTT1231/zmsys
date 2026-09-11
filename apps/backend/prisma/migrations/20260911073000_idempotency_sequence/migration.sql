-- 幂等与业务取号（内容与 docs/db/mysql-8-schema.sql 逐字一致，仅截取本模块相关表）。
-- db-scheme.md §1.3：幂等占位 (actor_id, operation_key, idempotency_key) 唯一；
-- 取号统一走 biz_sequence 行锁，禁止 MAX+1。

-- CreateTable
CREATE TABLE api_idempotency (
    id BIGINT NOT NULL,
    actor_id BIGINT NOT NULL,
    operation_key VARCHAR(120) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_hash BINARY(32) NOT NULL,
    state ENUM('PROCESSING', 'SUCCEEDED') NOT NULL DEFAULT 'PROCESSING',
    http_status SMALLINT UNSIGNED NULL,
    response_json JSON NULL,
    resource_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL,
    resource_code VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    expires_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_api_idempotency_request (actor_id, operation_key, idempotency_key),
    KEY idx_api_idempotency_expiry (expires_at),
    CONSTRAINT fk_api_idempotency_actor FOREIGN KEY (actor_id) REFERENCES sys_user (id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT ck_api_idempotency_key CHECK (CHAR_LENGTH(TRIM(idempotency_key)) BETWEEN 8 AND 128),
    CONSTRAINT ck_api_idempotency_response CHECK (
        (state = 'PROCESSING' AND http_status IS NULL AND response_json IS NULL)
        OR
        (state = 'SUCCEEDED' AND http_status BETWEEN 200 AND 299 AND JSON_TYPE(response_json) = 'OBJECT')
    ),
    CONSTRAINT ck_api_idempotency_expiry CHECK (expires_at > created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- CreateTable
CREATE TABLE biz_sequence (
    sequence_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    next_value BIGINT UNSIGNED NOT NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (sequence_key),
    CONSTRAINT ck_biz_sequence_next CHECK (next_value > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
