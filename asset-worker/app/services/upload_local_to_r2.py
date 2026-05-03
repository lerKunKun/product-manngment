"""
F2 子轨道占位：本地暂存文件 → R2 推送 + 视频缩略图。

当前架构（参见 backend-api LocalToR2UploadJob.java）：
    实际的 R2 上传由 backend 进程内调度任务完成。原因：
      1. asset-worker（FastAPI）目前不持有 DB 连接 / 共享文件系统挂载，
         给它加 DB + 共享卷的成本远大于 backend 直接 PutObject。
      2. R2 上传无非 boto3 一行 SDK 调用，backend 已有 R2Config + S3Client。
    所以本批 backend → worker 通讯走「方案 B 的变体 —— backend 进程内调度轮询」。

本文件存在的意义：
    当后续要做「视频缩略图（ffmpeg 抽帧）」、「office 病毒扫描（ClamAV）」这类
    backend 不方便做的事，将原地接管 r2_status=PENDING 的处理流程。届时 backend
    侧 LocalToR2UploadJob 改为只做 image，video / office 路径切到这里。

集成大纲（TODO，未实现）：
    1. 新增 DB 直连或 backend 内部 API：
       - GET /internal/file/pending（headers: X-Worker-Token）→ 返回 [{type, id, local_path, mime}]
       - POST /internal/file/{type}/{id}/r2-done  body: {key, url, thumbnail_url?}
       - POST /internal/file/{type}/{id}/r2-failed body: {error}
    2. 共享卷：backend 写本地的 ./data/uploads 同时挂到 worker 容器同路径。
    3. ffmpeg 抽帧：
       ```
       import ffmpeg
       (ffmpeg
          .input(local_path, ss="00:00:01")
          .output(thumb_path, vframes=1)
          .overwrite_output().run(quiet=True))
       ```
       拿到 thumb_path → 上传 R2 → 写回 thumbnail_url。
    4. 病毒扫描：
       ```
       import pyclamd
       cd = pyclamd.ClamdNetworkSocket(host="clamav", port=3310)
       result = cd.scan_stream(open(local_path, "rb").read())
       # result == None 表示 CLEAN；非 None 表示 INFECTED。
       ```

当前状态：本文件仅作为架构占位 + 后续实现的入口，**不被 main.py 注册为 router**，
不会影响现有 worker 行为。
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class UploadLocalToR2Service:
    """占位服务：未来接管 video/office 的 R2 推送 + 衍生（缩略图 / 扫描）任务。

    当前 backend 侧 LocalToR2UploadJob 已经覆盖 image/video/doc 的纯上传路径。
    这里只在需要 ffmpeg / antivirus 等 native 依赖时才接入。
    """

    def __init__(self, r2_client: Any, dry_run: bool = False) -> None:
        self.r2_client = r2_client
        self.dry_run = dry_run

    def process_pending(self, claim_url: str, worker_token: str) -> dict:
        """轮询 backend 拉取 PENDING 行，处理后回写状态。

        TODO: 实现细节见模块文档。当前为骨架。
        """
        logger.info("upload_local_to_r2: not yet wired (skipped)")
        return {"processed": 0, "skipped_reason": "not_implemented"}

    def make_video_thumbnail(self, local_path: str, output_path: str) -> bool:
        """ffmpeg 抽视频第 1 秒一帧。

        TODO: 接 ffmpeg-python；当前返 False 让 backend 直接置 thumbnail_url=NULL，
        前端 fallback 到 <video poster=""> 浏览器自带首帧。
        """
        logger.debug("video thumbnail TODO local=%s out=%s", local_path, output_path)
        return False

    def scan_office_file(self, local_path: str) -> str:
        """病毒扫描占位。返回 NOT_SCANNED / CLEAN / INFECTED / FAILED。

        TODO: 接 ClamAV (pyclamd) 或 VirusTotal API。
        """
        logger.debug("scan TODO local=%s", local_path)
        return "NOT_SCANNED"
