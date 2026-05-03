ALTER TABLE sys_user
  ADD COLUMN avatar_url VARCHAR(512) NULL COMMENT '头像 URL（钉钉同步或自上传）',
  ADD COLUMN position VARCHAR(64) NULL COMMENT '职位/岗位';
