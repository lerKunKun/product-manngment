-- ============================================
-- V30: 产品文件子系统 — 本地暂存 + 后台 worker 上传 R2 生命周期 + 标签 / 备注 / 视频缩略图 / office 病毒扫描占位
--
-- 决策：
--   F-Q2 上传走「先存本地 → 后台 worker 上传 R2 → R2 完毕后删本地」流程，故新增
--     local_path（本地暂存路径）+ r2_status（生命周期状态）+ r2_error（失败原因）。
--   F-Q4 视频做缩略图（thumbnail_url），office 文件做病毒扫描占位（scan_status，仅占位不接真扫描）。
--
-- 兼容性：
--   r2_status DEFAULT 'DONE' 让历史已落 R2 的行直接合规；新插入的 PENDING 行由后台 worker 推到 DONE。
--   media_type DEFAULT 'IMAGE' 给历史 product_image 行兜底（视频为本批新增能力）。
--   scan_status DEFAULT 'NOT_SCANNED' 是占位枚举值，配合 ScanStatusController 占位接口。
-- ============================================

SET NAMES utf8mb4;

-- ===================================================================
-- product_image：图片 / 视频生命周期
-- ===================================================================
ALTER TABLE product_image
  ADD COLUMN tags JSON NULL COMMENT '标签数组（前端校验必填，示例：["主图","白底"]）',
  ADD COLUMN remark VARCHAR(500) NULL COMMENT '备注（选填）',
  ADD COLUMN local_path VARCHAR(512) NULL COMMENT '本地暂存路径，R2 上传成功后清空（NULL 表示已只在 R2）',
  ADD COLUMN r2_status ENUM('PENDING','UPLOADING','DONE','FAILED') NOT NULL DEFAULT 'DONE' COMMENT 'R2 上传状态：PENDING=待 worker 拉取 / UPLOADING=worker 处理中 / DONE=R2 已就绪 / FAILED=失败；DEFAULT DONE 给历史数据兼容',
  ADD COLUMN r2_error VARCHAR(1024) NULL COMMENT '上传失败原因（仅 r2_status=FAILED 时有意义）',
  ADD COLUMN thumbnail_url VARCHAR(1024) NULL COMMENT '视频缩略图 URL（图片不用，视频由 worker 用 ffmpeg 抽帧或前端 fallback）',
  ADD COLUMN media_type ENUM('IMAGE','VIDEO') NOT NULL DEFAULT 'IMAGE' COMMENT '媒体类型：IMAGE=图片 / VIDEO=视频',
  ADD INDEX idx_r2_status (r2_status, id);

-- ===================================================================
-- product_doc：文档生命周期 + office 病毒扫描占位
-- ===================================================================
ALTER TABLE product_doc
  ADD COLUMN tags JSON NULL COMMENT '标签数组（前端校验必填，示例：["合同","2024Q4"]）',
  ADD COLUMN remark VARCHAR(500) NULL COMMENT '备注（选填）',
  ADD COLUMN local_path VARCHAR(512) NULL COMMENT '本地暂存路径，R2 上传成功后清空',
  ADD COLUMN r2_status ENUM('PENDING','UPLOADING','DONE','FAILED') NOT NULL DEFAULT 'DONE' COMMENT 'R2 上传状态：PENDING=待 worker / UPLOADING=worker 处理中 / DONE=就绪 / FAILED=失败；DEFAULT DONE 给历史数据兼容',
  ADD COLUMN r2_error VARCHAR(1024) NULL COMMENT '上传失败原因（仅 r2_status=FAILED 时有意义）',
  ADD COLUMN scan_status ENUM('NOT_SCANNED','CLEAN','INFECTED','FAILED') NOT NULL DEFAULT 'NOT_SCANNED' COMMENT 'office 病毒扫描状态：NOT_SCANNED=占位（未接真扫描引擎） / CLEAN=安全 / INFECTED=染毒 / FAILED=扫描失败；TODO 接 ClamAV / VirusTotal',
  ADD INDEX idx_r2_status (r2_status, id);
