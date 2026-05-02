-- W3-NEW-01：task 表扩展支持一键开店 saga（多步状态机）
ALTER TABLE task
  ADD COLUMN saga_step VARCHAR(64) NULL DEFAULT NULL AFTER status,
  ADD COLUMN saga_data_json LONGTEXT NULL DEFAULT NULL AFTER payload_json,
  ADD COLUMN saga_attempt INT NOT NULL DEFAULT 0 AFTER saga_data_json;
CREATE INDEX idx_task_saga_step ON task (type, saga_step, status);

-- saga_step 取值：null（非 saga 任务）/ INIT / AUTH_DONE / MEDIA / COLLECTIONS /
--                 PRODUCTS / GUIDE / THEME / PUBLISH / SUCCESS / FAILED
-- saga_data_json：累积上下文（已完成步骤的输出，下一步的输入）
-- saga_attempt：当前 step 的重试次数（0=首次，>0=重试）
